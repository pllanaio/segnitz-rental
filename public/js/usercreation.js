const path = require('path');
require('dotenv').config({
    path: path.resolve(__dirname, '../../.env')
});

const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const saltRounds = 10;

const allowedRoles = ['global_admin', 'user', 'bearbeiter'];

async function createUser(username, password, role = 'user') {
    if (!allowedRoles.includes(role)) {
        throw new Error(`Ungültige Rolle: ${role}`);
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PW,
        database: process.env.DB_NAME
    });

    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const [rows] = await connection.execute(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            [username, hashedPassword, role]
        );

        console.log('Benutzer wurde erfolgreich angelegt:', {
            id: rows.insertId,
            username,
            role
        });
    } catch (error) {
        console.error('Fehler beim Erstellen des Benutzers:', error);
    } finally {
        await connection.end();
    }
}

//createUser('admin', 'test1234', 'global_admin');
createUser('leon', 'test', 'user');
// createUser('mitarbeiter1', 'test1234', 'bearbeiter');