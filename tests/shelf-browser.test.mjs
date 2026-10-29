// Both shelves must search all visible metadata and group by source book without losing reading order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesShelfSearch,groupShelfByBook} from '../lib/shelf-browser.ts';
const stories=[
 {id:'recent',title:'一颗梨的价钱',book:'聊斋志异',theme:'人情冷暖',artStyleLabel:'水彩绘本'},
 {id:'other',title:'道旁苦李',book:'世说新语',theme:'聪明与糊涂',artStyleLabel:'工笔重彩'},
 {id:'older',title:'画皮',book:'聊斋志异',theme:'善意与误解',artStyleLabel:'电影写实'},
];
test('search matches title, source book, theme and art style, including combined keywords',()=>{
 for(const query of ['梨的价钱','聊斋','人情','水彩','聊斋 水彩','  人情  水彩  '])assert.equal(matchesShelfSearch(stories[0],query),true,query);
 assert.equal(matchesShelfSearch(stories[0],'聊斋 工笔'),false);
 assert.equal(matchesShelfSearch(stories[0],'   '),true);
 assert.equal(matchesShelfSearch({...stories[0],artStyleLabel:'3D 动画'},'３ｄ'),true);
 assert.deepEqual(stories.filter(story=>matchesShelfSearch(story,'聊斋')).map(story=>story.id),['recent','older']);
});
test('book groups collect matching stories in original reading order and omit empty search groups',()=>{
 const groups=groupShelfByBook(stories);
 assert.deepEqual(groups.map(group=>[group.book,group.items.map(story=>story.id)]),[['聊斋志异',['recent','older']],['世说新语',['other']]]);
 assert.deepEqual(groupShelfByBook(stories.filter(story=>matchesShelfSearch(story,'工笔'))).map(group=>group.book),['世说新语']);
 assert.deepEqual(groupShelfByBook([]),[]);
 assert.equal(groupShelfByBook([{...stories[0],book:''}])[0].book,'其他原典');
});
