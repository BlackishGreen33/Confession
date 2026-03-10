'use client';

import React from 'react';

import { PageLoading } from '@/components/loading/page-loading';
import { useI18n } from '@/hooks/use-i18n';

const Loading: React.FC = () => {
  const { t } = useI18n();
  return (
    <PageLoading
      title={t({
        'zh-TW': '儀表盤載入中',
        'zh-CN': '仪表盘加载中',
        en: 'Loading Dashboard',
      })}
      subtitle={t({
        'zh-TW': '正在整理安全態勢摘要與關鍵指標…',
        'zh-CN': '正在整理安全态势摘要与关键指标…',
        en: 'Preparing security summary and key metrics…',
      })}
    />
  );
};

export default Loading;
