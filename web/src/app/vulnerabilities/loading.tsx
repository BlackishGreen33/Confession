'use client';

import React from 'react';

import { PageLoading } from '@/components/loading/page-loading';
import { useI18n } from '@/hooks/use-i18n';

const Loading: React.FC = () => {
  const { t } = useI18n();
  return (
    <PageLoading
      title={t({
        'zh-TW': '漏洞列表載入中',
        'zh-CN': '漏洞列表加载中',
        en: 'Loading Vulnerabilities',
      })}
      subtitle={t({
        'zh-TW': '正在同步最新漏洞與篩選狀態…',
        'zh-CN': '正在同步最新漏洞与筛选状态…',
        en: 'Syncing latest vulnerabilities and filters…',
      })}
    />
  );
};

export default Loading;
