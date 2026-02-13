import React from 'react'

export default function LeftMediaPanel(){
  const items = new Array(6).fill(0).map((_,i)=>({id:i,title:`Clip ${i+1}`,dur:`0:${(i+10)%60}`}))
  return (
    <aside className="col-span-3 p-4 space-y-4">
      <h3 className="text-sm text-gray-300 font-medium">Project Video</h3>
      <div className="mt-2">
        <input className="w-full p-2 rounded-md bg-white/5 placeholder:text-gray-500" placeholder="Search media" />
      </div>
      <div className="mt-4 space-y-3">
        {items.map(it=> (
          <button key={it.id} className="w-full flex items-center gap-3 p-3 rounded-xl glass soft-glow hover:border-purple-500">
            <div className="w-16 h-10 bg-zinc-800 rounded-md" />
            <div className="flex-1 text-left">
              <div className="text-sm">{it.title}</div>
              <div className="text-xs text-gray-400">{it.dur}</div>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
