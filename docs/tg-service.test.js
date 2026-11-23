'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { telegram: { Api: {} } };
require('./tg-service.js');

test('discovers tvgram:auto folders with the same labels across groups', async () => {
    const config = { autoTags: ['playertv:auto', 'tvplayer:auto', 'tvgram:auto'] };
    const topics = [
        { id: 1, title: 'Películas tvgram:auto' },
        { id: 2, title: 'Series TVGRAM:AUTO' },
        { id: 3, title: 'Solo administración' }
    ];
    const catalogs = await Promise.all(['-100101', '-100202'].map(async groupId => {
        const service = new window.TelegramService({}, { ...config, groupId });
        service.getForumTopics = async () => topics;
        return (await service.getAutoTopics()).map(({ name, type }) => ({ name, type }));
    }));

    assert.deepEqual(catalogs[0], [
        { name: 'Películas', type: 'movie' },
        { name: 'Series', type: 'series' }
    ]);
    assert.deepEqual(catalogs[1], catalogs[0]);
});

test('loads forum topic pages beyond the first 100 folders', async () => {
    const originalApi = global.window.telegram.Api;
    global.window.telegram.Api = {
        channels: {
            GetForumTopics: class {
                constructor(params) { this.params = params; }
            }
        }
    };
    const requests = [];
    const client = {
        invoke: async request => {
            requests.push(request.params);
            if (requests.length === 1) {
                const topics = Array.from({ length: 100 }, (_, index) => ({
                    id: index + 1,
                    title: 'Folder ' + (index + 1),
                    topMessage: index + 1001,
                    date: 50
                }));
                return { count: 101, topics, messages: [{ id: 1100, date: 123 }] };
            }
            return { count: 101, topics: [{ id: 101, title: 'Folder 101', topMessage: 1101 }] };
        }
    };
    try {
        const service = new window.TelegramService(client, { groupId: '-1001' });
        service.resolveGroup = async () => ({});
        const topics = await service.getForumTopics();
        assert.equal(topics.length, 101);
        assert.equal(topics[100].title, 'Folder 101');
        assert.deepEqual(
            [requests[1].offsetDate, requests[1].offsetId, requests[1].offsetTopic],
            [123, 1100, 100]
        );
    } finally {
        global.window.telegram.Api = originalApi;
    }
});
