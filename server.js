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
// Configure CORS to allow the frontend origin (set FRONTEND_URL in .env)
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL || 'https://informxme.com'
app.use(cors({ origin: FRONTEND_ORIGIN, methods: ['GET','POST','OPTIONS'], credentials: true }))
app.use((req, res, next) => {
  // Ensure CORS headers are always present (helps when behind proxies)
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
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
