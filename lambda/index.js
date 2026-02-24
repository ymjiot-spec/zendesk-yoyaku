import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

/**
 * チケット情報から要約生成用のプロンプトを構築
 * @param {Array} tickets - チケット情報の配列
 * @returns {string} - 構築されたプロンプト
 */
export function buildPrompt(tickets) {
  if (!tickets || tickets.length === 0) {
    return '過去の問い合わせ履歴はありません。';
  }

  let prompt = '以下は顧客の過去の問い合わせ履歴です。この情報を基に、以下の3つの観点で要約を作成してください：\n\n';
  prompt += '1. **過去の問い合わせ履歴の要約**: 主な問い合わせ内容とその結果\n';
  prompt += '2. **注意点**: この顧客に対応する際に注意すべき点\n';
  prompt += '3. **対応のヒント**: 効果的な対応方法の提案\n\n';
  prompt += '---\n\n';
  prompt += '## 過去のチケット履歴\n\n';

  tickets.forEach((ticket, index) => {
    prompt += `### チケット ${index + 1}\n`;
    prompt += `- **件名**: ${ticket.subject}\n`;
    prompt += `- **作成日時**: ${ticket.created_at}\n`;
    prompt += `- **ステータス**: ${ticket.status}\n`;
    if (ticket.description) {
      prompt += `- **内容**: ${ticket.description}\n`;
    }
    prompt += '\n';
  });

  prompt += '---\n\n';
  prompt += '上記の情報を基に、簡潔で実用的な要約を日本語で作成してください。';

  return prompt;
}

/**
 * Amazon Bedrockを使用してプロンプトから要約を生成
 * @param {string} prompt - 要約生成用のプロンプト
 * @returns {Promise<string>} - 生成された要約テキスト
 */
export async function invokeBedrock(prompt) {
  const region = process.env.BEDROCK_REGION || 'us-east-1';
  const modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

  const client = new BedrockRuntimeClient({ region });

  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.7
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody)
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  if (responseBody.content && responseBody.content.length > 0) {
    return responseBody.content[0].text;
  }

  throw new Error('Bedrockからの応答が空です');
}

/**
 * アクセスログを記録
 * @param {string} endpoint - エンドポイント
 * @param {number} statusCode - HTTPステータスコード
 * @param {Object} metadata - 追加のメタデータ
 */
function logAccess(endpoint, statusCode, metadata = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    endpoint,
    status: statusCode,
    ...metadata
  };
  console.log('ACCESS_LOG:', JSON.stringify(logEntry));
}

/**
 * Lambda関数のハンドラー
 * @param {Object} event - API Gatewayからのイベント
 * @returns {Promise<Object>} - API Gatewayへのレスポンス
 */
export async function handler(event) {
  const startTime = Date.now();
  const endpoint = event.path || '/summarize';
  const httpMethod = event.httpMethod || event.requestContext?.http?.method || 'POST';
  
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    // リクエストボディの解析
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      const statusCode = 400;
      const duration = Date.now() - startTime;
      
      logAccess(endpoint, statusCode, {
        httpMethod,
        error: 'Invalid request body',
        duration
      });
      
      return {
        statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
          'Access-Control-Allow-Methods': 'POST,OPTIONS'
        },
        body: JSON.stringify({
          error: 'Invalid request body',
          message: 'リクエストボディの形式が不正です'
        })
      };
    }

    // チケット情報の検証
    if (!body.tickets || !Array.isArray(body.tickets)) {
      console.error('Invalid tickets data:', body);
      const statusCode = 400;
      const duration = Date.now() - startTime;
      
      logAccess(endpoint, statusCode, {
        httpMethod,
        error: 'Invalid tickets data',
        duration
      });
      
      return {
        statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
          'Access-Control-Allow-Methods': 'POST,OPTIONS'
        },
        body: JSON.stringify({
          error: 'Invalid tickets data',
          message: 'チケット情報が不正です'
        })
      };
    }

    // プロンプトの構築
    const prompt = buildPrompt(body.tickets);
    console.log('Built prompt for', body.tickets.length, 'tickets');

    // Bedrockの呼び出し
    let summary;
    try {
      summary = await invokeBedrock(prompt);
      console.log('Successfully generated summary');
    } catch (bedrockError) {
      console.error('Bedrock API error:', bedrockError);
      
      // Handle specific Bedrock errors (requirement 7.2)
      let errorMessage = '要約の生成中にエラーが発生しました';
      let statusCode = 500;
      
      if (bedrockError.name === 'ThrottlingException' || bedrockError.name === 'TooManyRequestsException') {
        errorMessage = 'APIリクエスト制限に達しました。しばらく待ってから再試行してください。';
        statusCode = 429;
      } else if (bedrockError.name === 'ValidationException') {
        errorMessage = 'リクエストが不正です。';
        statusCode = 400;
      } else if (bedrockError.name === 'AccessDeniedException') {
        errorMessage = 'Bedrock APIへのアクセスが拒否されました。';
        statusCode = 403;
      } else if (bedrockError.name === 'ModelTimeoutException' || bedrockError.name === 'TimeoutError') {
        errorMessage = 'Bedrock APIがタイムアウトしました。';
        statusCode = 504;
      } else if (bedrockError.name === 'ServiceUnavailableException') {
        errorMessage = 'Bedrock APIが一時的に利用できません。';
        statusCode = 503;
      }
      
      const duration = Date.now() - startTime;
      
      logAccess(endpoint, statusCode, {
        httpMethod,
        error: bedrockError.name || 'BedrockError',
        ticketCount: body.tickets.length,
        duration
      });
      
      return {
        statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
          'Access-Control-Allow-Methods': 'POST,OPTIONS'
        },
        body: JSON.stringify({
          error: bedrockError.name || 'BedrockError',
          message: errorMessage,
          details: bedrockError.message
        })
      };
    }

    // 成功レスポンスの返却
    const statusCode = 200;
    const duration = Date.now() - startTime;
    
    logAccess(endpoint, statusCode, {
      httpMethod,
      ticketCount: body.tickets.length,
      duration
    });
    
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
      },
      body: JSON.stringify({
        summary
      })
    };

  } catch (error) {
    console.error('Error processing request:', error);

    const statusCode = 500;
    const duration = Date.now() - startTime;
    
    logAccess(endpoint, statusCode, {
      httpMethod,
      error: 'Internal server error',
      duration
    });

    // エラーレスポンスの返却 (requirement 7.2, 7.5)
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: '要約の生成中にエラーが発生しました',
        details: error.message
      })
    };
  }
}
