'use client'

import React from 'react'

import { Dashboard } from '@/components/dashboard'

const Home: React.FC = () => {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-bold">安全儀表盤</h1>
      <Dashboard />
    </main>
  )
}

export default Home
