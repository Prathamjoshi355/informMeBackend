const express = require('express')
const fs = require('fs')
const path = require('path')
const bodyParser = require('body-parser')
const dotenv = require('dotenv')
const { MongoClient } = require('mongodb')

// load root .env (one level up)
dotenv.config({ path: path.join(__dirname, '../.env') })

const app = express()
const normalizeOrigin = (value = '') => String(value).replace(/\/+$/, '')
const allowedOrigins = [
  normalizeOrigin(process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL || 'https://informxme.com'),
  'https://www.informxme.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:4000'
]
const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function isAllowedOrigin(origin) {
  if (!origin) return true
  const normalized = normalizeOrigin(origin)
  return allowedOrigins.includes(normalized) || localOriginPattern.test(normalized)
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin
  const requestHeaders = req.headers['access-control-request-headers']

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', normalizeOrigin(origin))
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,DELETE')
  res.setHeader('Access-Control-Allow-Headers', requestHeaders || 'Content-Type,Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
}

app.use((req, res, next) => {
  applyCorsHeaders(req, res)

  if (req.method === 'OPTIONS') {
    return res.status(isAllowedOrigin(req.headers.origin) ? 204 : 403).end()
  }

  next()
})
app.use(bodyParser.json())

const DB = path.join(__dirname, 'submissions.json')

function readDB(){
  try{
    const raw = fs.readFileSync(DB,'utf8')
    return JSON.parse(raw)
  }catch(e){
    return []
  }
}

function writeDB(data){
  fs.writeFileSync(DB, JSON.stringify(data,null,2))
}

let submissionsCollection = null
let mongoClient = null

async function initDb(){
  const mongoUri = process.env.MONGODB_URI
  if(!mongoUri) return

  try{
    mongoClient = new MongoClient(mongoUri)
    await mongoClient.connect()
    const dbName = (new URL(mongoUri).pathname || '').replace('/','') || 'InformxMe'
    const db = mongoClient.db(dbName)
    submissionsCollection = db.collection('submissions')
    console.log('Connected to MongoDB:', mongoUri)
  }catch(err){
    console.error('MongoDB connection failed, falling back to file DB', err.message)
    submissionsCollection = null
  }
}

app.post('/api/submit', async (req, res) => {
  const payload = req.body || {}
  if(!payload.vehicle) return res.status(400).json({error:'vehicle required'})

  if(submissionsCollection){
    try{
      await submissionsCollection.insertOne(payload)
      return res.status(201).json({ok:true})
    }catch(err){
      console.error('Mongo insert failed', err)
      // fallback to file
    }
  }

  const all = readDB()
  all.push(payload)
  writeDB(all)
  res.status(201).json({ok:true})
})

app.get('/api/submissions', async (req,res)=>{
  if(submissionsCollection){
    try{
      const rows = await submissionsCollection.find().toArray()
      return res.json(rows)
    }catch(err){
      console.error('Mongo fetch failed', err)
    }
  }
  res.json(readDB())
})

async function getAdminSubmissions(req, res) {
  const password = req.query.pwd
  const adminPwd = process.env.ADMIN_PASSWORD || 'admin123'

  if (password !== adminPwd) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (submissionsCollection) {
    try {
      const rows = await submissionsCollection.find().toArray()
      return res.json(rows)
    } catch (err) {
      console.error('Mongo fetch failed', err)
    }
  }

  res.json(readDB())
}

app.get('/api/admin/submissions', getAdminSubmissions)
app.get('/admin/submissions', getAdminSubmissions)

app.use((err, req, res, next) => {
  applyCorsHeaders(req, res)
  console.error(err)
  res.status(err.status || 500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 4000

async function start(){
  await initDb()
  // If a production build exists, serve static files from client/dist
  const clientDist = path.join(__dirname, '../client/dist')
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist))
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'))
    })
    console.log('Serving client from', clientDist)
  }

  app.listen(PORT, ()=> console.log(`Server listening on ${PORT}`))
}

start()