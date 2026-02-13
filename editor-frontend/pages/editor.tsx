import React from 'react'
import EditorShell from '../components/EditorShell'
import TopToolbar from '../components/TopToolbar'
import LeftMediaPanel from '../components/LeftMediaPanel'
import CenterPreviewPanel from '../components/CenterPreviewPanel'
import TimelinePanel from '../components/TimelinePanel'
import RightInspectorPanel from '../components/RightInspectorPanel'
import StatusCard from '../components/StatusCard'

export default function EditorPage(){
  return (
    <EditorShell>
      <TopToolbar />

      <LeftMediaPanel />

      <div className="col-span-6 relative">
        <CenterPreviewPanel />
        <TimelinePanel />
      </div>

      <RightInspectorPanel />

      <StatusCard />
    </EditorShell>
  )
}
