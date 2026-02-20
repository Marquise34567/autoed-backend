import fetch from 'node-fetch'
const base = process.env.BASE_URL || 'http://localhost:8080'

async function main(){
  console.log('health')
  console.log(await (await fetch(base + '/api/health')).json())
  console.log('debug/db')
  console.log(await (await fetch(base + '/api/debug/db')).json())
}

main()
