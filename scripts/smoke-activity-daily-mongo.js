'use strict';
const fs = require('node:fs'),
    mongoose = require('mongoose');
const uri = process.argv[2]
    ? fs.readFileSync(process.argv[2], 'utf8').trim()
    : process.env.DAILY_TEST_MONGO_URL;
if (!uri || !['127.0.0.1', 'localhost'].includes(new URL(uri).hostname))
    throw new Error('An isolated local DAILY_TEST_MONGO_URL is required');
const database =
    'insider_daily_test_' +
    require('node:crypto').randomUUID().replaceAll('-', '');
const timer = setTimeout(() => {
    console.error('Mongo daily test did not finish');
    process.exit(1);
}, 90000);
(async () => {
    await mongoose.connect(uri, {
        dbName: database,
        serverSelectionTimeoutMS: 10000,
    });
    const {
        ActivityArchive: root,
        ActivityDaily: daily,
    } = require('../managers/models');
    await Promise.all([root.init(), daily.init()]);
    let scans = 0;
    const find = root.find.bind(root);
    root.find = (...args) => {
        const query = find(...args),
            cursor = query.cursor.bind(query);
        query.cursor = (...args) => {
            scans++;
            return cursor(...args);
        };
        return query;
    };
    await require('./activityDailyCases')({
        name: 'MongoDB',
        root,
        daily,
        archive: (options) =>
            require('../managers/activityArchive').createActivityArchive({
                ...options,
                useDatabase: true,
                model: root,
                dailyModel: daily,
            }),
        seed: (entries) =>
            root.collection.insertMany(
                entries.map((entry) => ({
                    _id: 'log:' + entry.id,
                    at: new Date(entry.timestamp),
                    entry,
                })),
            ),
        cursorCount: () => scans,
        rawCount: () => root.countDocuments({}),
        dailyData: () => daily.find({}).lean(),
    });
    const plan = await root
        .find({
            at: { $gte: new Date('2026-10-01') },
            'entry.gameMode': 'slave',
        })
        .sort({ at: -1, 'entry.id': -1 })
        .limit(50)
        .explain('executionStats');
    if (JSON.stringify(plan.queryPlanner.winningPlan).includes('COLLSCAN'))
        throw new Error('History page did not use an index');
    console.log('Indexed Mongo history pagination passed');
})()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        clearTimeout(timer);
        if (mongoose.connection.readyState === 1)
            await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    });
