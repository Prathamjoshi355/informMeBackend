const express = require('express')
const fs = require('fs')
const path = require('path')
const bodyParser = require('body-parser')
const cors = require('cors')
const dotenv = require('dotenv')
const { MongoClient } = require('mongodb')

// load root .env (one level up)
dotenv.config({ path: path.join(__dirname, '../.env') })

const app = express()
// Configure CORS with an allowlist of origins. This uses a dynamic origin
// check so we return the exact requesting Origin in Access-Control-Allow-Origin.
const rawFrontend = process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL || 'https://informxme.com'
const FRONTEND_ORIGIN = String(rawFrontend).replace(/\/+$/, '')
const allowedOrigins = [
  FRONTEND_ORIGIN,
  'https://www.informxme.com',
  'http://localhost:5173',
  'http://localhost:5174'
]

app.use(cors({
  origin: function(origin, cb) {
    // Allow non-browser requests with no origin (curl, servers)
    if (!origin) return cb(null, true)
    const norm = String(origin).replace(/\/+$/, '')
    if (allowedOrigins.includes(norm)) return cb(null, true)
    return cb(new Error('CORS origin denied'))
  },
  methods: ['GET','POST','OPTIONS','PUT','DELETE'],
  credentials: true
}))

// Ensure preflight requests return the correct headers
app.options('*', (req, res) => {
  const origin = req.headers.origin ? String(req.headers.origin).replace(/\/+$/, '') : ''
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,DELETE')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    return res.status(204).end()
  }
  // Deny
  return res.status(403).end()
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

// Admin endpoint to fetch submissions (password protected)
app.get('/admin/submissions', (req, res) => {
  const password = req.query.pwd
  const adminPwd = process.env.ADMIN_PASSWORD || 'admin123'
  
  if (password !== adminPwd) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  // Return submissions from MongoDB or file
  if (submissionsCollection) {
    submissionsCollection.find().toArray()
      .then(rows => res.json(rows))
      .catch(err => {
        console.error('Mongo fetch failed', err)
        res.json(readDB())
      })
  } else {
    res.json(readDB())
  }
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
