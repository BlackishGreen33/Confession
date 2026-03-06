'use client';

import React from 'react';

import { PageLoading } from '@/components/loading/page-loading';

const Loading: React.FC = () => {
  return <PageLoading title="儀表盤載入中" subtitle="正在整理安全態勢摘要與關鍵指標…" />;
};

export default Loading;
