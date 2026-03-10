'use client';

import React from 'react';

import { PageLoading } from '@/components/loading/page-loading';
import { useI18n } from '@/hooks/use-i18n';

const Loading: React.FC = () => {
  const { t } = useI18n();
  return (
    <PageLoading
      title={t({
        'zh-TW': '設定載入中',
        'zh-CN': '设置加载中',
        en: 'Loading Settings',
      })}
      subtitle={t({
        'zh-TW': '正在讀取 LLM、掃描與同步設定…',
        'zh-CN': '正在读取 LLM、扫描与同步设置…',
        en: 'Loading LLM, scan, and sync settings…',
      })}
    />
  );
};

export default Loading;
