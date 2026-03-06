'use client';

import React from 'react';

import { PageLoading } from '@/components/loading/page-loading';

const Loading: React.FC = () => {
  return <PageLoading title="漏洞列表載入中" subtitle="正在同步最新漏洞與篩選狀態…" />;
};

export default Loading;
