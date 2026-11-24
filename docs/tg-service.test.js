'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = { telegram: { Api: {} } };
require('./tg-service.js');

test('links a numbered Telegram video to its poster without showing a duplicate card', () => {
    const service = new window.TelegramService({}, { groupId: '-1001' });
    const topic = { id: 2, name: 'Películas', type: 'movie' };
    const items = service._buildTopicItems([
        {
            id: 92,
            message: 'Shutter Island\nhttps://m.filmaffinity.com/es/film173696.html\nSinopsis: Teddy Daniels investiga la desaparición de una paciente en una isla remota.\nurl=091',
            media: { photo: {} }
        },
        {
            id: 451,
            message: '091-SHUTTER ISLAND (2010) 🇪🇸',
            media: { document: {
                id: 'video-451', mimeType: 'video/mp4', size: 1024,
                attributes: [{ className: 'DocumentAttributeFilename', fileName: 'shutter-island.mp4' }],
                thumbs: []
            } }
        }
    ], topic);

    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Shutter Island');
    assert.doesNotMatch(items[0].description, /url\s*=\s*091/i);
    assert.equal(items[0].description, 'Teddy Daniels investiga la desaparición de una paciente en una isla remota.');
    assert.equal(items[0].metadataLinks[0].metadataSource.label, 'FilmAffinity');
    assert.equal(items[0].links.some(link => /filmaffinity/i.test(link.url)), false);
    assert.equal(items[0].links[0].streamUrl, 'tgstream/2/451?group=-1001');
});

test('fast catalog returns a limited catalog without external enrichment', async () => {
    const service = new window.TelegramService({}, {
        groupId: '-1001', messagesPerTopic: 300
    });
    service.getAutoTopics = async () => [{ id: 2, name: 'Películas', type: 'movie' }];
    service.getTopicMessages = async () => [];

    const catalog = await service.getCatalog({ limit: 100 });
    assert.equal(catalog.partial, true);
    assert.equal(catalog.categories.length, 1);
});

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
