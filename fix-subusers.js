const fs = require('fs');

const USERS_FILE = './users.json';
let users = JSON.parse(fs.readFileSync(USERS_FILE));

users = users.map(u => {
  if(u.createdBy) return u;
  const creator = users.find(c => c.serial === u.serial && c.id !== u.id);
  if(creator) {
    u.createdBy = creator.id;
  }
  return u;
});

fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
console.log('Subusuarios existentes actualizados con createdBy.');