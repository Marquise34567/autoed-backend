import React from 'react'

export default function RightInspectorPanel(){
  return (
    <aside className="col-span-3 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <button className="px-3 py-1 rounded-full bg-white/6">Video</button>
        <button className="px-3 py-1 rounded-full bg-transparent text-gray-400">Animation</button>
        <button className="px-3 py-1 rounded-full bg-transparent text-gray-400">Tracking</button>
      </div>

      <div className="glass p-3 rounded-xl">
        <div className="text-xs text-gray-400">Volume</div>
        <div className="mt-2 h-2 bg-white/6 rounded" />
      </div>

      <div className="glass p-3 rounded-xl">
        <div className="text-xs text-gray-400">Background</div>
        <div className="mt-3 h-24 rounded-md bg-gradient-to-br from-purple-800 to-indigo-900/40" />
      </div>

      <div className="mt-auto glass p-4 rounded-xl">
        <div className="text-sm font-medium">Hi Mike! How can I help you?</div>
        <div className="mt-3 flex gap-2">
          <button className="flex-1 px-3 py-2 rounded-md bg-white/6">Generate Text</button>
          <button className="px-3 py-2 rounded-md bg-white/6">Images</button>
        </div>
      </div>
    </aside>
  )
}
