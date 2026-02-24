import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildPrompt } from './index.js';

/**
 * Property-Based Tests for Bedrock Request Construction
 * **Validates: Requirements 5.2, 5.3**
 */

describe('Property 6: Bedrock API Request Construction', () => {
  /**
   * Arbitrary generator for ticket objects
   */
  const ticketArbitrary = fc.record({
    subject: fc.string({ minLength: 1, maxLength: 200 }),
    created_at: fc.integer({ min: 1577836800000, max: 1735689600000 }).map(timestamp => new Date(timestamp).toISOString()),
    status: fc.constantFrom('new', 'open', 'pending', 'solved', 'closed'),
    description: fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined })
  });

  /**
   * Property: プロンプトには必ず3つの要求セクションが含まれる
   * - 過去の問い合わせ履歴の要約
   * - 注意点
   * - 対応のヒント
   */
  it('should always include three required sections in the prompt', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArbitrary, { minLength: 1, maxLength: 10 }),
        (tickets) => {
          const prompt = buildPrompt(tickets);
          
          // プロンプトに3つの必須セクションが含まれることを検証
          expect(prompt).toContain('過去の問い合わせ履歴の要約');
          expect(prompt).toContain('注意点');
          expect(prompt).toContain('対応のヒント');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: プロンプトには全てのチケット情報が含まれる
   */
  it('should include all ticket information in the prompt', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArbitrary, { minLength: 1, maxLength: 10 }),
        (tickets) => {
          const prompt = buildPrompt(tickets);
          
          // 各チケットの件名、作成日時、ステータスが含まれることを検証
          tickets.forEach((ticket) => {
            expect(prompt).toContain(ticket.subject);
            expect(prompt).toContain(ticket.created_at);
            expect(prompt).toContain(ticket.status);
            
            // descriptionが存在する場合は含まれることを検証
            if (ticket.description) {
              expect(prompt).toContain(ticket.description);
            }
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: 空のチケット配列の場合、適切なメッセージを返す
   */
  it('should return appropriate message for empty ticket array', () => {
    fc.assert(
      fc.property(
        fc.constantFrom([], null, undefined),
        (emptyInput) => {
          const prompt = buildPrompt(emptyInput);
          
          // 空の場合は「過去の問い合わせ履歴はありません」を返すことを検証
          expect(prompt).toBe('過去の問い合わせ履歴はありません。');
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: プロンプトは常に文字列を返す
   */
  it('should always return a string', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArbitrary, { minLength: 0, maxLength: 10 }),
        (tickets) => {
          const prompt = buildPrompt(tickets);
          
          // 返り値が文字列であることを検証
          expect(typeof prompt).toBe('string');
          expect(prompt.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: プロンプトには日本語での要約作成指示が含まれる
   */
  it('should include instruction to create summary in Japanese', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArbitrary, { minLength: 1, maxLength: 10 }),
        (tickets) => {
          const prompt = buildPrompt(tickets);
          
          // 日本語での要約作成指示が含まれることを検証
          expect(prompt).toContain('日本語');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: チケット数が増えてもプロンプトの構造は一貫している
   */
  it('should maintain consistent structure regardless of ticket count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(ticketArbitrary, { minLength: 1, maxLength: 1 }),
        (count, sampleTickets) => {
          // 同じチケットを複数回繰り返して配列を作成
          const tickets = Array(count).fill(sampleTickets[0]);
          const prompt = buildPrompt(tickets);
          
          // 必須セクションが含まれることを検証
          expect(prompt).toContain('過去の問い合わせ履歴の要約');
          expect(prompt).toContain('注意点');
          expect(prompt).toContain('対応のヒント');
          
          // チケット番号が正しく付与されていることを検証
          for (let i = 1; i <= count; i++) {
            expect(prompt).toContain(`チケット ${i}`);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
