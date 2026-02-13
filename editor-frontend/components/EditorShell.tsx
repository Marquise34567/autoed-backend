import React from 'react'

export default function EditorShell({ children }: { children: React.ReactNode }){
  return (
    <div className="min-h-screen p-8 flex items-center justify-center">
      <div className="w-full max-w-[1400px] rounded-3xl glass shadow-2xl p-6 grid grid-cols-12 gap-6">
        {children}
      </div>
    </div>
  )
}
