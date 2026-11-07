'use strict';
const createTestModel = require('./testActivityModel');
const { createActivityArchive } = require('../managers/activityArchive');
const run = require('./activityDailyCases');
let scans = 0;
const root = createTestModel(new Map(), (event) => {
        if (event === 'open') scans++;
    }),
    daily = createTestModel();
const timer = setTimeout(() => {
    console.error('Daily test did not finish');
    process.exit(1);
}, 30000);
run({
    name: 'fault-injection',
    root,
    daily,
    archive: (options) =>
        createActivityArchive({
            ...options,
            useDatabase: true,
            model: root,
            dailyModel: daily,
        }),
    seed: async (entries) => {
        for (const entry of entries)
            root.data.set('log:' + entry.id, {
                _id: 'log:' + entry.id,
                at: new Date(entry.timestamp),
                entry,
            });
    },
    cursorCount: () => scans,
    rawCount: async () => root.data.size,
    dailyData: async () => [...daily.data.values()],
})
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => clearTimeout(timer));
