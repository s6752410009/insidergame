// Small in-memory Mongo adapter for deterministic fault injection; real Mongo is
// exercised separately by smoke-activity-daily-mongo.js against an isolated URL.
module.exports = function createTestModel(
    database = new Map(),
    onCursor = () => {},
) {
    const value = (row, key) =>
        key.split('.').reduce((part, name) => part?.[name], row);
    const matches = (row, filter) =>
        Object.entries(filter).every(([key, want]) => {
            const got = value(row, key);
            if (want && typeof want === 'object' && !(want instanceof Date))
                return Object.entries(want).every(([operator, expected]) => {
                    if (operator === '$exists')
                        return (got !== undefined) === expected;
                    if (operator === '$ne')
                        return expected === null
                            ? got != null
                            : got !== expected;
                    if (operator === '$in') return expected.includes(got);
                    if (operator === '$gte') return got >= expected;
                    if (operator === '$lte') return got <= expected;
                    if (operator === '$lt') return got < expected;
                    throw new Error('Unsupported test operator: ' + operator);
                });
            return want === null ? got == null : got === want;
        });
    function query(filter, single = false) {
        let order = {},
            offset = 0,
            limit = Infinity;
        const values = () => {
            let rows = [...database.values()].filter((row) =>
                matches(row, filter),
            );
            const keys = Object.entries(order);
            if (keys.length)
                rows.sort((a, b) => {
                    for (const [key, direction] of keys) {
                        const av = value(a, key),
                            bv = value(b, key);
                        if (av < bv) return -direction;
                        if (av > bv) return direction;
                    }
                    return 0;
                });
            return rows
                .slice(offset, offset + limit)
                .map((row) => structuredClone(row));
        };
        return {
            sort(sort) {
                order = sort;
                return this;
            },
            skip(n) {
                offset = n;
                return this;
            },
            limit(n) {
                limit = n;
                return this;
            },
            lean() {
                return this;
            },
            then(resolve, reject) {
                const rows = values();
                return Promise.resolve(single ? rows[0] || null : rows).then(
                    resolve,
                    reject,
                );
            },
            cursor() {
                onCursor('open');
                return {
                    async *[Symbol.asyncIterator]() {
                        yield* values();
                    },
                    async close() {
                        onCursor('close');
                    },
                };
            },
        };
    }
    return {
        data: database,
        async init() {},
        find: (filter) => query(filter || {}),
        findOne: (filter) => query(filter || {}, true),
        findById: (id) => query({ _id: id }, true),
        async distinct(key, filter) {
            return [
                ...new Set(
                    [...database.values()]
                        .filter((row) => matches(row, filter))
                        .map((row) => value(row, key)),
                ),
            ];
        },
        async updateMany(filter, update) {
            for (const row of database.values())
                if (matches(row, filter))
                    Object.assign(row, structuredClone(update.$set));
        },
        async replaceOne(filter, doc) {
            database.set(filter._id, structuredClone(doc));
        },
        async bulkWrite(operations) {
            for (const { updateOne: item } of operations) {
                let row = database.get(item.filter._id);
                if (!row) {
                    row = {
                        _id: item.filter._id,
                        ...structuredClone(item.update.$setOnInsert || {}),
                    };
                    database.set(item.filter._id, row);
                }
                if (item.update.$set)
                    Object.assign(row, structuredClone(item.update.$set));
            }
        },
    };
};
