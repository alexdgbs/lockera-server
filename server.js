require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = process.env.PORT || 3000;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.use(cors({
  origin: '*',
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
function authMiddleware(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ message: 'No autorizado: falta userId' });
  const user = users.find(u => u.id == userId);
  if (!user) return res.status(401).json({ message: 'No autorizado: userId inválido' });
  req.user = user;
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
  res.json({ message: 'Login exitoso', userId: user.id });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const { password, ...userData } = req.user;
  res.json(userData);
});

app.get('/api/users', authMiddleware, (req, res) => {
  const subUsers = users.filter(u => u.createdBy === req.user.id);
  const sanitized = subUsers.map(u => {
    const { password, ...data } = u;
    return data;
  });
  res.json(sanitized);
});

app.post('/api/users', authMiddleware, (req, res) => {
  const { firstName, lastName } = req.body;
  if (!firstName || !lastName) return res.status(400).json({ message: 'Faltan datos' });

  const newUser = {
    id: Date.now(),
    name: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@lockera.com`,
    password: null,
    serial: req.user.serial,
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers();

  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario agregado por ${req.user.name}`,
    html: `<h3>Nuevo subusuario agregado</h3>
           <p>Usuario principal: <b>${req.user.name}</b> (${req.user.email})</p>
           <p>Subusuario agregado: <b>${newUser.name}</b> (${newUser.email})</p>
           <p>Fecha: ${new Date().toLocaleString()}</p>`
  };

  sgMail.send(msg).catch(err => console.error(err));

  res.json({ message: 'Subusuario agregado correctamente', user: newUser });
});

app.post('/api/users/delete', authMiddleware, (req, res) => {
  const { subUserId } = req.body;
  const subUserIndex = users.findIndex(u => u.id === Number(subUserId) && u.createdBy === req.user.id);
  if (subUserIndex === -1) return res.status(404).json({ message: 'Subusuario no encontrado' });

  const removedUser = users.splice(subUserIndex, 1)[0];
  saveUsers();

  const msg = {
    to: 'securebylockera@gmail.com',
    from: 'securebylockera@gmail.com',
    subject: `Subusuario eliminado por ${req.user.name}`,
    html: `<h3>Subusuario eliminado</h3>
           <p>Usuario principal: <b>${req.user.name}</b> (${req.user.email})</p>
           <p>Subusuario eliminado: <b>${removedUser.name}</b> (${removedUser.email})</p>
           <p>Fecha: ${new Date().toLocaleString()}</p>`
  };

  sgMail.send(msg).catch(err => console.error(err));
  res.json({ message: 'Subusuario eliminado correctamente', user: removedUser });
});

app.post('/api/generate-serial', (req, res) => {
  const { serial } = req.body;
  if (!serial) return res.status(400).json({ message: 'Falta serial' });
  if (serials.find(s => s.serial === serial)) return res.status(400).json({ message: 'Serial ya existe' });
  serials.push({ serial, used: false });
  saveSerials();
  res.json({ message: 'Serial agregado correctamente', serial });
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
