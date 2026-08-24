import express from 'express'
import { getDb } from './db.js'
import { ObjectId } from 'mongodb'

const app = express()
app.use(express.json())

const isTestEnv = process.env.NODE_ENV === 'test';

if (!isTestEnv && !process.env.DB_NAME) {
    console.error('[error*****]: please, pass DB_NAME env before running it!')
    process.exit(1)
}

const { dbClient, collections: { dbUsers } } = await getDb()

// CORS + preflight handling (replaces Fastify preHandler hook)
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "*");

    const isPreflight = /options/i.test(req.method);
    if (isPreflight) {
        return res.end();
    }

    next();
})

// Body validation (replaces Fastify body JSON schema: required name, phone)
function requireNamePhone(req, res, next) {
    const { name, phone } = req.body || {}
    if (typeof name !== 'string' || typeof phone !== 'string') {
        return res.status(400).json({ message: 'body must have required properties: name, phone' })
    }
    next()
}

app.get('/v1/health', (request, reply) => {
    reply.status(200).json({ app: 'customers', version: 'v1.0.1' })
})

app.get('/v1/customers', async (request, reply) => {
    const users = await dbUsers
        .find({})
        .sort({ name: 1 })
        .toArray()

    return reply.status(200).json(users)
})

app.get('/v1/customers/:id', async (request, reply) => {
    const { id } = request.params
    if (!ObjectId.isValid(id)) {
        return reply.status(400).json({ message: 'the id is invalid!', id })
    }

    const user = await dbUsers.findOne({ _id: ObjectId.createFromHexString(id) }) // Assuming id is stored in MongoDB ObjectId format

    if (!user) {
        return reply.status(404).json({ error: 'User not found' })
    }
    const { _id, ...remainingUserData } = user

    return reply.status(200).json({
        ...remainingUserData,
        id,
    })
})

app.post('/v1/customers', requireNamePhone, async (request, reply) => {
    const user = request.body
    const result = await dbUsers.insertOne(user)
    return reply.status(201).json({ message: `user ${user.name} created!`, id: result.insertedId.toString() })
})

app.put('/v1/customers/:id', requireNamePhone, async (request, reply) => {
    const { id } = request.params
    const user = request.body
    if (!ObjectId.isValid(id)) {
        return reply.status(400).json({ message: 'the id is invalid!', id })
    }

    const result = await dbUsers.updateOne({ _id: ObjectId.createFromHexString(id) }, { $set: user })

    if (!result.modifiedCount) {
        return reply.status(404).json({ message: 'User not found or no changes made', id })
    }

    return reply.status(200).json({ message: `User ${id} updated!`, id })
})

app.delete('/v1/customers/:id', async (request, reply) => {
    const { id } = request.params
    if (!ObjectId.isValid(id)) {
        return reply.status(400).json({ message: 'the id is invalid!', id })
    }

    const result = await dbUsers.deleteOne({ _id: ObjectId.createFromHexString(id) })

    if (!result.deletedCount) {
        return reply.status(404).end()
    }

    return reply.status(200).json({ message: `User ${id} deleted!`, id })
})

let httpServer = null

// Server facade preserving the Fastify surface used by the app + tests:
// .inject() (light-my-request, the same lib Fastify bundles), .listen(), .close()
const server = {
    inject(opts) {
        return import('light-my-request').then(({ inject }) => inject(app, opts))
    },
    async listen(opts = {}) {
        const port = opts.port ?? 0
        const host = opts.host ?? '127.0.0.1'
        httpServer = app.listen(port, host)
        await new Promise((resolve) => httpServer.once('listening', resolve))
        const addr = httpServer.address()
        const h = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address
        return `http://${h}:${addr.port}`
    },
    async close() {
        console.log('server closed!')
        if (httpServer) {
            await new Promise((resolve) => httpServer.close(resolve))
            httpServer = null
        }
        return dbClient.close()
    },
}

if (!isTestEnv) {
    const serverInfo = await server.listen({
        port: process.env.PORT || 9999,
        host: '::',
    })

    console.log(`server is running at ${serverInfo}`)
}

export { server }
