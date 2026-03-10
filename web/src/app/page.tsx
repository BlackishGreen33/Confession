'use client'

import React from 'react'

import { Dashboard } from '@/components/dashboard/main'
import { MotionReveal } from '@/motion/reveal'

const Home: React.FC = () => {
  return (
    <main className="h-full overflow-y-auto custom-scrollbar bg-cyber-bg pb-20">
      <div className="mx-auto w-full max-w-[1320px] p-6 md:p-8">
        <MotionReveal>
          <Dashboard />
        </MotionReveal>
      </div>
    </main>
  )
}

export default Home
