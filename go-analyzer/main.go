// go-analyzer/main.go
// Go AST 靜態分析器 — 編譯為 WASM，在瀏覽器/Node.js 中執行。
// 使用 go/parser + go/ast 遍歷 Go 原始碼，識別高風險模式並以 JSON 輸出。
//
// 偵測模式：
//   - exec.Command / exec.CommandContext（命令注入）
//   - sql.DB 直接拼接查詢（SQL 注入）
//   - http.ResponseWriter 未處理錯誤
//   - os.Setenv / os.Getenv 敏感環境變數操作
//   - 不安全的 crypto 使用（md5、sha1）
//
// 編譯：GOOS=js GOARCH=wasm go build -o go-analyzer.wasm main.go

package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"syscall/js"
)

// InteractionPoint 對應 TypeScript 端的 InteractionPoint 介面
type InteractionPoint struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Language    string `json:"language"`
	FilePath    string `json:"filePath"`
	Line        int    `json:"line"`
	Column      int    `json:"column"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
	CodeSnippet string `json:"codeSnippet"`
	PatternName string `json:"patternName"`
	Confidence  string `json:"confidence"`
}

// analyzeRequest 從 JS 端傳入的分析請求
type analyzeRequest struct {
	FilePath string `json:"filePath"`
	Content  string `json:"content"`
}

// analyzeResponse 回傳給 JS 端的分析結果
type analyzeResponse struct {
	Points []InteractionPoint `json:"points"`
	Error  string             `json:"error,omitempty"`
}


// ---------------------------------------------------------------------------
// 計數器：用於產生唯一 ID（WASM 環境無 crypto/rand）
// ---------------------------------------------------------------------------

var idCounter int

func nextID() string {
	idCounter++
	return fmt.Sprintf("go-%d", idCounter)
}

// ---------------------------------------------------------------------------
// 核心分析函式
// ---------------------------------------------------------------------------

// analyzeGo 解析 Go 原始碼並回傳所有偵測到的交互點
func analyzeGo(filePath, content string) analyzeResponse {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, filePath, content, parser.AllErrors)
	if err != nil {
		return analyzeResponse{Error: fmt.Sprintf("解析失敗: %v", err)}
	}

	lines := strings.Split(content, "\n")
	var points []InteractionPoint

	ast.Inspect(file, func(n ast.Node) bool {
		if n == nil {
			return false
		}

		switch node := n.(type) {
		case *ast.CallExpr:
			points = append(points, detectCallPatterns(node, fset, filePath, lines)...)
		case *ast.AssignStmt:
			points = append(points, detectUncheckedError(node, fset, filePath, lines)...)
		}

		return true
	})

	if points == nil {
		points = []InteractionPoint{}
	}
	return analyzeResponse{Points: points}
}


// ---------------------------------------------------------------------------
// 模式偵測：函式呼叫
// ---------------------------------------------------------------------------

// detectCallPatterns 偵測危險的函式呼叫模式
func detectCallPatterns(call *ast.CallExpr, fset *token.FileSet, filePath string, lines []string) []InteractionPoint {
	var points []InteractionPoint

	name := extractCallName(call)
	if name == "" {
		return points
	}

	// exec.Command / exec.CommandContext — 命令注入風險
	if name == "exec.Command" || name == "exec.CommandContext" {
		points = append(points, makePoint(
			call, fset, filePath, lines,
			"dangerous_call", name, "high",
		))
	}

	// sql.Query / sql.QueryRow / sql.Exec — 直接拼接查詢（SQL 注入）
	// 偵測 db.Query("SELECT ... " + userInput) 等模式
	if name == "Query" || name == "QueryRow" || name == "Exec" ||
		name == "QueryContext" || name == "ExecContext" {
		if hasConcatArg(call) {
			points = append(points, makePoint(
				call, fset, filePath, lines,
				"dangerous_call", "sql."+name, "high",
			))
		}
	}

	// os.Setenv / os.Getenv — 敏感環境變數操作
	if name == "os.Setenv" || name == "os.Getenv" {
		if hasSensitiveEnvKey(call) {
			points = append(points, makePoint(
				call, fset, filePath, lines,
				"sensitive_data", name, "medium",
			))
		}
	}

	// md5.New / md5.Sum / sha1.New / sha1.Sum — 不安全的雜湊
	if name == "md5.New" || name == "md5.Sum" || name == "sha1.New" || name == "sha1.Sum" {
		points = append(points, makePoint(
			call, fset, filePath, lines,
			"unsafe_pattern", name, "medium",
		))
	}

	// http.ListenAndServe（無 TLS）
	if name == "http.ListenAndServe" {
		points = append(points, makePoint(
			call, fset, filePath, lines,
			"unsafe_pattern", name, "low",
		))
	}

	return points
}


// ---------------------------------------------------------------------------
// 模式偵測：未檢查的錯誤回傳值
// ---------------------------------------------------------------------------

// detectUncheckedError 偵測 http.ResponseWriter.Write 等呼叫的錯誤未被處理
// 模式：_, _ = w.Write(...) 或直接 w.Write(...) 不接收回傳值
func detectUncheckedError(assign *ast.AssignStmt, fset *token.FileSet, filePath string, lines []string) []InteractionPoint {
	var points []InteractionPoint

	// 檢查 a, _ := someCall() 模式（第二個值被丟棄）
	if len(assign.Lhs) >= 2 {
		lastLhs := assign.Lhs[len(assign.Lhs)-1]
		if ident, ok := lastLhs.(*ast.Ident); ok && ident.Name == "_" {
			for _, rhs := range assign.Rhs {
				if call, ok := rhs.(*ast.CallExpr); ok {
					name := extractCallName(call)
					if isHTTPWriteMethod(name) {
						points = append(points, makePoint(
							call, fset, filePath, lines,
							"unsafe_pattern", "http_unhandled_error", "medium",
						))
					}
				}
			}
		}
	}

	return points
}

// isHTTPWriteMethod 判斷是否為 HTTP 回應寫入方法
func isHTTPWriteMethod(name string) bool {
	return name == "Write" || name == "WriteHeader" || name == "WriteString"
}

// ---------------------------------------------------------------------------
// 輔助函式
// ---------------------------------------------------------------------------

// extractCallName 從 CallExpr 中提取呼叫名稱
// 支援：funcName()、pkg.FuncName()、obj.Method()
func extractCallName(call *ast.CallExpr) string {
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return fn.Name
	case *ast.SelectorExpr:
		if ident, ok := fn.X.(*ast.Ident); ok {
			return ident.Name + "." + fn.Sel.Name
		}
		return fn.Sel.Name
	}
	return ""
}

// hasConcatArg 檢查呼叫的第一個參數是否包含字串拼接（BinaryExpr with +）
func hasConcatArg(call *ast.CallExpr) bool {
	if len(call.Args) == 0 {
		return false
	}
	return containsConcat(call.Args[0])
}

// containsConcat 遞迴檢查表達式是否包含字串拼接
func containsConcat(expr ast.Expr) bool {
	switch e := expr.(type) {
	case *ast.BinaryExpr:
		if e.Op == token.ADD {
			// 至少一側是字串字面值，另一側是變數 → 可能是拼接
			_, leftIsStr := e.X.(*ast.BasicLit)
			_, rightIsStr := e.Y.(*ast.BasicLit)
			if leftIsStr || rightIsStr {
				return true
			}
			// 遞迴檢查
			return containsConcat(e.X) || containsConcat(e.Y)
		}
	case *ast.CallExpr:
		// fmt.Sprintf 等格式化呼叫也算拼接
		name := extractCallName(e)
		if name == "fmt.Sprintf" {
			return true
		}
	}
	return false
}


// hasSensitiveEnvKey 檢查 os.Setenv/os.Getenv 的 key 是否為敏感值
func hasSensitiveEnvKey(call *ast.CallExpr) bool {
	if len(call.Args) == 0 {
		return false
	}
	lit, ok := call.Args[0].(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return false
	}
	// 去除引號
	key := strings.Trim(lit.Value, `"'` + "`")
	lower := strings.ToLower(key)
	sensitiveKeys := []string{"password", "secret", "token", "api_key", "apikey", "private_key"}
	for _, s := range sensitiveKeys {
		if strings.Contains(lower, s) {
			return true
		}
	}
	return false
}

// makePoint 建立 InteractionPoint
func makePoint(
	node ast.Node,
	fset *token.FileSet,
	filePath string,
	lines []string,
	pointType, patternName, confidence string,
) InteractionPoint {
	startPos := fset.Position(node.Pos())
	endPos := fset.Position(node.End())

	// 提取程式碼片段（涵蓋節點所在行）
	startLine := startPos.Line - 1 // 轉為 0-based 索引
	endLine := endPos.Line - 1
	if startLine < 0 {
		startLine = 0
	}
	if endLine >= len(lines) {
		endLine = len(lines) - 1
	}
	snippet := strings.Join(lines[startLine:endLine+1], "\n")
	snippet = strings.TrimSpace(snippet)

	return InteractionPoint{
		ID:          nextID(),
		Type:        pointType,
		Language:    "go",
		FilePath:    filePath,
		Line:        startPos.Line,   // 1-based
		Column:      startPos.Column, // 1-based
		EndLine:     endPos.Line,
		EndColumn:   endPos.Column,
		CodeSnippet: snippet,
		PatternName: patternName,
		Confidence:  confidence,
	}
}


// ---------------------------------------------------------------------------
// WASM 橋接：暴露 analyzeGo 給 JavaScript
// ---------------------------------------------------------------------------

// analyzeGoJS 是 JS 端呼叫的入口
// 參數：JSON 字串 { "filePath": "...", "content": "..." }
// 回傳：JSON 字串 { "points": [...], "error": "..." }
func analyzeGoJS(_ js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return toJSON(analyzeResponse{Error: "缺少參數：需要 JSON 字串"})
	}

	input := args[0].String()
	var req analyzeRequest
	if err := json.Unmarshal([]byte(input), &req); err != nil {
		return toJSON(analyzeResponse{Error: fmt.Sprintf("JSON 解析失敗: %v", err)})
	}

	result := analyzeGo(req.FilePath, req.Content)
	return toJSON(result)
}

// toJSON 將結構體序列化為 JSON 字串
func toJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf(`{"points":[],"error":"JSON 序列化失敗: %v"}`, err)
	}
	return string(b)
}

func main() {
	// 註冊全域函式供 JS 呼叫
	js.Global().Set("analyzeGo", js.FuncOf(analyzeGoJS))

	// 保持 WASM 程式持續運行
	select {}
}
