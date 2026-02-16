(async () => {
  const body = { storagePath: 'test-inputs/post_test.mp4', filename: 'post_test.mp4', contentType: 'video/mp4' }
  try {
    const res = await fetch('http://localhost:8080/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const text = await res.text()
    console.log('STATUS', res.status)
    console.log('BODY', text)
  } catch (err) {
    console.error('ERR', err)
  }
})()
