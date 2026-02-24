'use client'

import React from 'react'

import { Dashboard } from '@/components/dashboard'

const Home: React.FC = () => {
  return (
    <main className="h-full overflow-y-auto custom-scrollbar bg-cyber-bg pb-20">
      <div className="p-4 md:p-8 max-w-[1600px] mx-auto w-full">
        <Dashboard />
      </div>
    </main>
  )
}

export default Home
