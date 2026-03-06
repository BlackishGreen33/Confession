'use client';

import React from 'react';

import { PageLoading } from '@/components/loading/page-loading';

const Loading: React.FC = () => {
  return <PageLoading title="設定載入中" subtitle="正在讀取 LLM、掃描與同步設定…" />;
};

export default Loading;
