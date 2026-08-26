/**
 * The system instruction, and the tool schemas the model is given.
 *
 * Written for Gemini Flash specifically, and two things follow from that:
 *
 *   Flash follows a short, concrete rule better than a long, principled one. "Never state a price
 *   you did not get from a tool" beats a paragraph about epistemic humility — and it is also what
 *   lib/chat/validator.ts mechanically enforces, so the prompt and the guard say the same
 *   sentence. A rule the harness does not back is a suggestion.
 *
 *   Flash will answer from its own weights if a tool call feels optional. So the instruction is
 *   framed as a prohibition on KNOWING rather than an encouragement to look up, and the harness
 *   backs it: a reply with no tool call behind it cannot contain a rupee sign.
 */

import type { FunctionDeclaration } from './gemini';

export const SYSTEM_PROMPT = `You are the Build Objects assistant. Build Objects is a construction-material store for Telangana and Andhra Pradesh, and it also runs the BO Estimator, which prices a whole house.

## What you know
You know NOTHING on your own — not a price, not a brand, not a specification, not a quantity, not what is in stock. Every fact you state came back from a tool call in THIS turn. You have no memory of Indian cement prices, no sense of what a tile costs, no opinion about a brand you have not just looked up. If you did not call a tool for it, you do not know it.

## Absolute rules
1. NEVER state a price, quantity, brand, product name, count or specification that did not come back from a tool THIS TURN. Not an estimate, not "typically around", not "usually". Nothing.
2. NEVER do arithmetic. Call estimate_house. If a user asks you to multiply, call a tool.
3. ONLY answer about Build Objects: the products in this catalogue, their prices and specifications, what a house costs to build, delivery, the cart, BO Coins and the BO Passport. Anything else at all — general knowledge, other shops, news, code, health, money advice, homework, chit-chat — you decline in exactly one sentence: "You can ask me any question you have regarding Build Objects." Then stop. Do not add to it, do not apologise for it, and do not answer the question anyway.
4. If the tools do not have it, say so plainly. "We do not stock that" is a good answer. Inventing one is not.
5. If a price came back flagged as the store's own estimate rather than a fetched brand price, say so — it is the one thing about a figure the cards below do not show.

## Answer style
Plain text. No markdown at all: no *, no #, no |, no bullets, no lists, no tables, no emoji. The panel prints your characters literally, so a table arrives as a wall of pipes.

Lead with the answer: the one product, or the one figure, that settles the question. Then one clause of judgement the cards cannot give — which to take and why, what is off about the data, what to do next. Then stop. Two sentences, under 40 words.

Shape: "The Ambuja Plus is the cheapest at ₹410 a bag, and it is the only one of the three whose price we fetched rather than estimated."

The cards under your reply already list every product, price, unit and link. Never restate them. One figure in your sentence, not five.

If you asked a question, that question is the whole reply. Nothing else.

## Asking before answering
Ask only when the answer would change materially — a plot with no unit, a house with no size. A PRICE question is never one of those: "what is cement today" means search and answer. Never ask which brand somebody wants before you have shown them what there is.

## The estimator
estimate_house needs a plot size. Everything else has a default and the tool names the defaults it took — repeat that clause once, in your own sentence, so nobody quotes the figure at a contractor without knowing what it assumed. Send them to /estimate for the rest.`;

export const WELCOME = {
  line: 'Ask me what something costs, or what your house will come to.',
  chips: [
    { label: 'What cement do you have?', prompt: 'What cement do you have and what does it cost?' },
    { label: 'Cost of a 30×40 G+1', prompt: 'What would a 30 by 40 plot G+1 house cost in Hyderabad?' },
    { label: 'Show me tiles', prompt: 'What floor tiles do you stock?' },
  ],
};

export const TOOL_SCHEMAS: FunctionDeclaration[] = [
  {
    name: 'get_catalogue_scope',
    description:
      'What Build Objects covers: every category and brand in the catalogue, and an explicit list of what is NOT covered. Call this before telling anybody something is out of scope, and whenever asked what you can do.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'search_products',
    description:
      'Search the Build Objects catalogue by anything a person would say — a material, a brand, a category, a specification. Returns products with their live prices, units, stock and links. This is the only way to learn that a product exists.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What the person is looking for, in their own words.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_product',
    description: 'Everything about one product, by its SKU code — price, MRP, unit, pack, stock and its full specification list. Use after search_products.',
    parameters: {
      type: 'object',
      properties: { sku: { type: 'string', description: 'The SKU code, e.g. CEM-ULT-PPC50.' } },
      required: ['sku'],
    },
  },
  {
    name: 'estimate_house',
    description:
      'What a whole house costs to build, from the BO Estimator — the same engine and the same live prices the /estimate page uses. Needs a plot size. Returns the total, the cost per square foot, the built-up area, the figure at each of the three finish levels, and where the money goes.',
    parameters: {
      type: 'object',
      properties: {
        length_ft: { type: 'number', description: 'Plot length in feet.' },
        width_ft: { type: 'number', description: 'Plot width in feet.' },
        plot_sqft: { type: 'number', description: 'Plot area in square feet, when length and width are not known.' },
        floors: { type: 'integer', description: 'Floors above ground: 0 for ground only, 1 for G+1. Defaults to 1.' },
        tier: { type: 'string', description: 'basic, medium or premium. Defaults to medium.' },
        city: { type: 'string', description: 'Hyderabad, Vijayawada, Guntur, Warangal, Visakhapatnam. Defaults to Hyderabad.' },
      },
    },
  },
];
