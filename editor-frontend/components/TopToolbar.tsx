import React from 'react'

export default function TopToolbar(){
  return (
    <div className="col-span-12 flex items-center justify-between gap-4 p-3 bg-gradient-to-b from-transparent to-black/20 glass rounded-2xl">
      <div className="flex items-center gap-3">
        <button className="p-2 rounded-md bg-white/6">←</button>
        <button className="p-2 rounded-md bg-white/6">⤺</button>
        <button className="p-2 rounded-md bg-white/6">⤻</button>
      </div>
      <div className="flex items-center gap-3 text-sm text-gray-300">
        <div className="flex gap-2 items-center bg-white/3 p-2 rounded-full">
          <span className="w-3 h-3 rounded-full bg-purple-400" />
          <span>Pointer</span>
        </div>
        <div className="flex gap-2 items-center text-xs text-gray-400">● ● ●</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-indigo-500" />
        <button className="px-4 py-2 rounded-lg bg-purple-600">Export</button>
      </div>
    </div>
  )
}
