require('dotenv').config();
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const saltRounds = 10;

async function createUser(username, password) {
    const connection = await mysql.createConnection(
        {host: process.env.DB_HOST, user: process.env.DB_USER, password: 'MldeSf8536!', database: process.env.DB_NAME}
    );

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

createUser('r.nather', 'DmVtiT3U@^$5');
createUser('a.roelz', 'ZKU*!V4mf8h7');
createUser('h.roelz', '@k2dAKqB5JE9');
createUser('t.hörenz', '4JUL$egSjXou');
createUser('j.hörenz', '!*DCN%3aqPcq');