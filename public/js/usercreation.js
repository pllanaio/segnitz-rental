const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '../../.env')
});

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const saltRounds = 10;

async function createUser(username, password) {
    const connection = await mysql.createConnection(
        {host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PW, database: process.env.DB_NAME}
    );
console.log({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  db: process.env.DB_NAME
});
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const [rows] = await connection.execute(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, hashedPassword]
        );
        console.log('Benutzer wurde erfolgreich angelegt:', rows);
    } catch (error) {
        console.error('Fehler beim Erstellen des Benutzers:', error);
    } finally {
        await connection.end();
    }
}

createUser('admin', 'test1234');