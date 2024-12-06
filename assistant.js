import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import { handleResponses } from './contentScript.js';

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey });

const model = 'gpt-4o';

async function createAssistant() {
    const assistant = await client.assistants.create({
        name: 'Form Filler',
        instructions: `You are an assistant who helps users fill forms. You will be given data corresponding to the form entries and you will have to determine what is the best response for each form. Additionally, sometimes you will work with the user in improving certain responses.`,
        tools: [
            { type: 'file_search' },
            {
                type: 'function',
                function: {
                    name: 'fill_forms',
                    description: `Fill in forms entries. Remember that you might have access to files that can help you make informed responses.`,
                    parameters: {
                        type: 'object',
                        properties: {
                            responses: {
                                type: 'string',
                                items: {"type": "string"},
                                description: `A list of strings of the forms responses with format form_name: value.`,
                            },
                        },
                        required: ['responses'],
                    },
                },
            },
        ],
        model,
    });
    console.log('Assistant created:', assistant.id);
    return assistant;
}

async function createThread() {
    const thread = await client.threads.create();
    console.log('Thread created:', thread.id);
    return thread;
}

async function createVectorStore() {
    const vectorStore = await client.vectorStores.create({
        name: 'Personal Data',
    });
    console.log('Vector store created:', vectorStore.id);
    return vectorStore;
}

async function addFiles(vectorStoreId, files) {
    try {
        const fileStreams = files.map((filePath) => {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }
            return fs.createReadStream(filePath);
        });

        const fileBatch = await client.vectorStores.fileBatches.uploadAndPoll({
            vectorStoreId,
            files: fileStreams,
        });

        console.log('File batch status:', fileBatch.status);
        console.log('File counts:', fileBatch.fileCounts);
    } catch (error) {
        console.error('Error adding files:', error.message);
    }
}


async function sendMessage(threadId, content) {
    const message = await client.threads.messages.create({
        threadId,
        role: 'user',
        content,
    });
    console.log('Message sent:', message.id);
    return message;
}

async function runAssistant(threadId, assistantId, instructions) {
    const run = await client.threads.runs.createAndPoll({
        threadId,
        assistantId,
        instructions,
    });
    console.log('Run completed with status:', run.status);
    return run;
}

async function fillForms(responses) {
    handleResponses(responses)
    return "forms are being filled"
}

async function handleFunctionCalls(actions, runId, threadId) {
    const toolOutputs = actions.toolCalls.map((action) => {
        const { name, arguments: args } = action.function;
        let result = 'Failed to handle function';

        if (name === 'fill_forms') {
            result = fillForms(args.responses);
        }

        return {
            toolCallId: action.id,
            output: result,
        };
    });

    if (toolOutputs.length) {
        const run = await client.threads.runs.submitToolOutputsAndPoll({
            threadId,
            runId,
            toolOutputs,
        });
        return run;
    }
}

async function printResponse(run, threadId) {
    if (run && run.status === 'completed') {
        const messages = await client.threads.messages.list({ threadId });
        console.log('Assistant:', messages.data[0].content[0].text.value);
    } else if (run && run.status === 'requires_action') {
        const newRun = await handleFunctionCalls(
            run.requiredAction.submitToolOutputs.modelDump(),
            run.id,
            threadId
        );
        if (newRun) {
            await printResponse(newRun, threadId);
        } else {
            console.error('Failed to process function call response.');
        }
    } else {
        console.error(`Run status: ${run ? run.status : 'Run is None'}`);
    }
}

const assistant = await createAssistant();
let thread = await createThread();
let vectorStore = await createVectorStore();
console.log('Thread ID:', thread.id);
console.log('Assistant ID:', assistant.id);

export function formCall(forms) {
    const message = await sendMessage(thread.id, "Fill out the following forms: " + JSON.stringify(forms));
    const run = await runAssistant(thread.id, assistant.id, "");
    console.log('Run completed:', run.status);
    return  client.beta.threads.messages.list(thread_id=thread_id)
}

