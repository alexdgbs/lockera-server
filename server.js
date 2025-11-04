require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.use(cors({
  origin: ['http://localhost:5173', 'https://lockera.vercel.app'],
  credentials: true
}));
app.use(bodyParser.json());

const USERS_FILE = path.join(__dirname, 'users.json');
let users = [];
if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE));

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const SERIALS_FILE = path.join(__dirname, 'serials.json');
let serials = [];
if (fs.existsSync(SERIALS_FILE)) serials = JSON.parse(fs.readFileSync(SERIALS_FILE));

function saveSerials() {
  fs.writeFileSync(SERIALS_FILE, JSON.stringify(serials, null, 2));
}

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No autorizado' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Token inválido' });
    req.user = user;
    next();
  });
}

app.post('/api/register', async (req, res) => {
  const { name, email, password, serial } = req.body;
  if (!name || !email || !password || !serial) return res.status(400).json({ message: 'Faltan datos' });
  if (users.find(u => u.email === email)) return res.status(400).json({ message: 'Correo ya registrado' });
  const serialEntry = serials.find(s => s.serial === String(serial) && s.used === false);
  if (!serialEntry) return res.status(400).json({ message: 'Serial inválido o ya usado' });
  const hashed = await bcrypt.hash(password, 10);
  const newUser = { id: Date.now(), name, email, password: hashed, serial };
  users.push(newUser);
  saveUsers();
  serialEntry.used = true;
  saveSerials();
  res.json({ message: 'Usuario registrado correctamente' });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ message: 'Usuario no encontrado' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: 'Contraseña incorrecta' });
  const token = generateToken(user);
  res.json({ message: 'Login exitoso', token });
});

app.get('/api/me', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ message: 'No autorizado' });
  const { password, ...userData } = user;
  res.json(userData);
});

app.post('/api/logout', (req, res) => {
  res.json({ message: 'Sesión cerrada' });
});

app.post('/api/users', authenticateToken, (req, res) => {
  const { firstName, lastName } = req.body;
  const creator = users.find(u => u.id === req.user.id);
  if (!creator) return res.status(401).json({ message: 'No autorizado' });
  const newUser = {
    id: Date.now(),
    name: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@lockera.com`,
    password: null,
    serial: creator.serial,
    createdBy: creator.id,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  saveUsers();
  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario agregado por ${creator.name}`,
    html: `<h3>Nuevo subusuario agregado</h3>
           <p>Usuario principal: <b>${creator.name}</b> (${creator.email})</p>
           <p>Subusuario agregado: <b>${newUser.name}</b> (${newUser.email})</p>
           <p>Fecha: ${new Date().toLocaleString()}</p>`
  };
  sgMail.send(msg).catch(err => console.error(err));
  res.json({ message: 'Subusuario agregado correctamente', user: newUser });
});

app.get('/api/users', authenticateToken, (req, res) => {
  const creatorId = req.user.id;
  const subUsers = users.filter(u => u.createdBy === creatorId);
  const sanitized = subUsers.map(u => {
    const { password, ...data } = u;
    return data;
  });
  res.json(sanitized);
});

app.get('/api/subusers/:id', authenticateToken, (req, res) => {
  const subUserId = Number(req.params.id);
  const subUser = users.find(u => u.id === subUserId);
  if (!subUser) return res.status(404).json({ message: 'Subusuario no encontrado' });
  const { password, ...userData } = subUser;
  res.json(userData);
});

app.delete('/api/users/:id', authenticateToken, (req, res) => {
  const creator = users.find(u => u.id === req.user.id);
  if (!creator) return res.status(401).json({ message: 'No autorizado' });
  const subUserId = Number(req.params.id);
  const subUserIndex = users.findIndex(u => u.id === subUserId);
  if (subUserIndex === -1) return res.status(404).json({ message: 'Subusuario no encontrado' });
  const removedUser = users.splice(subUserIndex, 1)[0];
  saveUsers();
  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario eliminado por ${creator.name}`,
    html: `<h3>Subusuario eliminado</h3>
           <p>Usuario principal: <b>${creator.name}</b> (${creator.email})</p>
           <p>Subusuario eliminado: <b>${removedUser.name}</b> (${removedUser.email})</p>
           <p>Fecha: ${new Date().toLocaleString()}</p>`
  };
  sgMail.send(msg).catch(err => console.error(err));
  res.json({ message: 'Subusuario eliminado correctamente', user: removedUser });
});

app.post('/api/generate-serial', authenticateToken, (req, res) => {
  const { serial } = req.body;
  if (!serial) return res.status(400).json({ message: 'Falta serial' });
  if (serials.find(s => s.serial === serial)) return res.status(400).json({ message: 'Serial ya existe' });
  serials.push({ serial, used: false });
  saveSerials();
  res.json({ message: 'Serial agregado correctamente', serial });
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
