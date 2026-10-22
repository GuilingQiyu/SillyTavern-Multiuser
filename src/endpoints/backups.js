import express from 'express';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { CHAT_BACKUPS_PREFIX, getChatInfo } from './chats.js';

export const router = express.Router();

router.post('/chat/get', async (request, response) => {
    try {
        const backupModels = [];
        const errors = [];

        if (!fs.existsSync(request.user.directories.backups)) {
            return response.json(request.body?.withErrors ? { backups: [], errors: [] } : []);
        }

        const backupFiles = await fsPromises
            .readdir(request.user.directories.backups, { withFileTypes: true })
            .then(d => d.filter(d => d.isFile() && path.extname(d.name) === '.jsonl' && d.name.startsWith(CHAT_BACKUPS_PREFIX)).map(d => d.name));

        for (const name of backupFiles) {
            const filePath = path.join(request.user.directories.backups, name);
            try {
                const info = await getChatInfo(filePath);
                if (!info || !info.file_name) {
                    errors.push(name);
                    continue;
                }
                backupModels.push(info);
            } catch (fileError) {
                console.error(`[Backups] Failed to read backup file ${name}:`, fileError);
                errors.push(name);
            }
        }

        if (errors.length > 0) {
            response.set('X-Backup-Errors', encodeURIComponent(JSON.stringify(errors)));
        }

        if (request.body?.withErrors) {
            return response.json({ backups: backupModels, errors });
        }

        return response.json(backupModels);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/chat/delete', async (request, response) => {
    try {
        const { name } = request.body;
        const filePath = path.join(request.user.directories.backups, sanitize(name));

        if (!path.parse(filePath).base.startsWith(CHAT_BACKUPS_PREFIX)) {
            console.warn('Attempt to delete non-chat backup file:', name);
            return response.sendStatus(400);
        }

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        await fsPromises.unlink(filePath);
        return response.sendStatus(200);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/chat/download', async (request, response) => {
    try {
        const { name } = request.body;
        const filePath = path.join(request.user.directories.backups, sanitize(name));

        if (!path.parse(filePath).base.startsWith(CHAT_BACKUPS_PREFIX)) {
            console.warn('Attempt to download non-chat backup file:', name);
            return response.sendStatus(400);
        }

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        return response.download(filePath);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
