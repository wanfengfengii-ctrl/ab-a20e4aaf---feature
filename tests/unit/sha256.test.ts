import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/sha256';

describe('sha256Hex 公开测试向量', () => {
  it('空串', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('abc', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('448 位双块消息', () => {
    expect(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    ).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('百万个 a（多块压力）', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

describe('sha256Hex 与 node:crypto 交叉核对', () => {
  const samples = [
    '审查链封存',
    '张工/工号 0042',
    '{"seq":1,"prevDigest":"0000"}',
    '带换行\n与制表\t符',
    'emoji 😀 与代理对',
    'x'.repeat(55), // 填充边界：55/56/64/65 字节
    'x'.repeat(56),
    'x'.repeat(64),
    'x'.repeat(65),
    '长'.repeat(200),
  ];

  for (const s of samples) {
    it(`与 createHash 一致：${JSON.stringify(s.slice(0, 20))}（${s.length} 字符）`, () => {
      const expected = createHash('sha256').update(s, 'utf8').digest('hex');
      expect(sha256Hex(s)).toBe(expected);
    });
  }
});
