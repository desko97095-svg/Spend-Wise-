import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Healthcheck
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Lazy instantiate Gemini SDK safely
  const getGeminiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not configured.');
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  // Endpoint: Generate Automated Monthly AI Budgeting Report
  app.post('/api/reports/generate', async (req, res) => {
    try {
      const { month, transactions, budgets, currency, language, totalIncome, totalExpenses } = req.body;

      if (!transactions || !Array.isArray(transactions)) {
        return res.status(400).json({ error: 'Invalid or missing transactions array' });
      }

      const ai = getGeminiClient();

      const prompt = `
Generate a structured, insightful monthly financial report for the month of ${month || 'Current Month'}.
Data overview:
- Currency: ${currency || 'USD'}
- Language for localized text response: ${language || 'en'}
- Total Income: ${totalIncome}
- Total Expenses: ${totalExpenses}
- Active Budgets: ${JSON.stringify(budgets || {})}
- Transactions summary: ${JSON.stringify(
        transactions.map((t) => ({
          title: t.title,
          amount: t.amount,
          type: t.type,
          category: t.category,
          date: t.date,
          tags: t.tags,
        }))
      )}

Please analyze:
1. Financial Health Score (0-100 score based on savings rate, budget compliance, and spending velocity).
2. Executive Summary in 2-3 sentences in language: ${language || 'en'}.
3. Key Insights (3-4 items, marking each as positive, warning, alert, or info).
4. Category breakdown evaluation (variance % vs budgeted amount).
5. Savings Opportunities & top spending concentration area.
6. Forecast for next month with recommended category budget adjustments.

Return valid JSON adhering strictly to this schema structure.
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              month: { type: Type.STRING },
              generatedAt: { type: Type.STRING },
              healthScore: { type: Type.NUMBER },
              summary: { type: Type.STRING },
              keyInsights: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: 'positive | warning | alert | info' },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: ['type', 'title', 'description'],
                },
              },
              categoryBreakdown: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    spent: { type: Type.NUMBER },
                    budgeted: { type: Type.NUMBER },
                    variancePercent: { type: Type.NUMBER },
                    status: { type: Type.STRING, description: 'under | warning | over' },
                  },
                  required: ['category', 'spent', 'budgeted', 'status'],
                },
              },
              savingsOpportunity: {
                type: Type.OBJECT,
                properties: {
                  potentialSavings: { type: Type.NUMBER },
                  topWasteArea: { type: Type.STRING },
                  actionableTips: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: ['potentialSavings', 'topWasteArea', 'actionableTips'],
              },
              forecastNextMonth: {
                type: Type.OBJECT,
                properties: {
                  estimatedExpense: { type: Type.NUMBER },
                  suggestedAdjustments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        category: { type: Type.STRING },
                        recommendedLimit: { type: Type.NUMBER },
                        reason: { type: Type.STRING },
                      },
                      required: ['category', 'recommendedLimit', 'reason'],
                    },
                  },
                },
                required: ['estimatedExpense', 'suggestedAdjustments'],
              },
            },
            required: [
              'month',
              'generatedAt',
              'healthScore',
              'summary',
              'keyInsights',
              'categoryBreakdown',
              'savingsOpportunity',
              'forecastNextMonth',
            ],
          },
        },
      });

      const reportJson = JSON.parse(response.text || '{}');
      return res.json(reportJson);
    } catch (error: any) {
      console.error('Error in /api/reports/generate:', error);
      return res.status(500).json({
        error: 'Failed to generate AI report',
        details: error?.message || 'Server error',
      });
    }
  });

  // Endpoint: AI Transaction Categorization & Smart Tagging
  app.post('/api/ai/categorize', async (req, res) => {
    try {
      const { title, amount } = req.body;
      const ai = getGeminiClient();

      const prompt = `Categorize this financial transaction title: "${title}" (Amount: ${amount}).
Allowed category IDs: housing, food, transport, entertainment, tech, health, shopping, utilities, travel, investments, salary, freelance, other.
Return JSON: { "category": "<categoryId>", "suggestedTags": ["tag1", "tag2"] }`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              suggestedTags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['category', 'suggestedTags'],
          },
        },
      });

      const json = JSON.parse(response.text || '{}');
      return res.json(json);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Categorization error' });
    }
  });

  // Vite Middleware for dev mode vs static serve for production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SpendWise Express server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
