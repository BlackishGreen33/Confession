# go-analyzer/Makefile
# 將 Go AST 分析器編譯為 WASM，輸出到 web/public/

WASM_OUT := ../web/public/go-analyzer.wasm
WASM_EXEC_SRC := $(shell go env GOROOT)/lib/wasm/wasm_exec.js
WASM_EXEC_OUT := ../web/public/wasm_exec.js

.PHONY: build clean copy-exec all

all: build copy-exec

build:
	@mkdir -p ../web/public
	GOOS=js GOARCH=wasm go build -o $(WASM_OUT) main.go
	@echo "✓ WASM 編譯完成: $(WASM_OUT)"

copy-exec:
	@cp $(WASM_EXEC_SRC) $(WASM_EXEC_OUT)
	@echo "✓ wasm_exec.js 已複製: $(WASM_EXEC_OUT)"

clean:
	@rm -f $(WASM_OUT) $(WASM_EXEC_OUT)
	@echo "✓ 已清理 WASM 產物"
