from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app) 


# ASSISTANT CODE
import openai
from dotenv import find_dotenv, load_dotenv
import json

load_dotenv()

client = openai.OpenAI()
model = "gpt-4o"

# Create assistant and thread
assistant = client.beta.assistants.create(
    name="Form Filler",
    instructions="""You are an assistant who helps users fills forms. You will be given data corresponding to the form 
    entries and you will have to determine what is the best response for each form. Additionally, sometimes you will
    work with the user in improving certain responses.""",
    tools=[
        {
            "type": "function",
            "function": {
                "name": "fill_forms",
                "description": "Use this tool to fill in forms entries. Remember that you might have access to files that can help you make informed responses.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "responses": {
                            "type": "string",
                            "items": {"type": "string"},
                            "description": "A  list of strings of the forms responses with format form_name: value. MAKE SURE that the form_name corresponds to the name of the form, which may seem abstract or misleading."
                        }
                    },
                    "required": ["responses"]
                }
            }
        }
    ],
    model=model,
)

assistant_helper = client.beta.assistants.create(
  name="Form Discussur",
  instructions="You are a personal assistant that helps users work through answers to different forms.",
  model="gpt-4o",
)
helper_thread = None

thread = client.beta.threads.create()
ai_assistant_id = assistant.id
thread_id = thread.id
print("Thread ID:", thread_id)
print("Assistant ID:", ai_assistant_id)
responses = None

vector_store = client.beta.vector_stores.create(name="Personal Data")

def addFiles(files):

    # Ready the files for upload to OpenAI
    file_paths = files#["edgar/goog-10k.pdf", "edgar/brka-10k.txt"]
    file_streams = [open(path, "rb") for path in file_paths]
    
    # Use the upload and poll SDK helper to upload the files, add them to the vector store,
    # and poll the status of the file batch for completion.
    file_batch = client.beta.vector_stores.file_batches.upload_and_poll(
    vector_store_id=vector_store.id, files=file_streams
    )
    
    # You can print the status and the file counts of the batch to see the result of this operation.
    print(file_batch.status)
    print(file_batch.file_counts)

    assistant = client.beta.assistants.update(
    assistant_id=assistant.id,
    tool_resources={"file_search": {"vector_store_ids": [vector_store.id]}},


    #MIGHT NEED TO DO THIS SEPARATELY
    # Create a thread and attach the file to the message
    thread = client.beta.threads.create(
    messages=[
        {
        "role": "user",
        "content": "How many shares of AAPL were outstanding at the end of of October 2023?",
        # Attach the new file to the message.
        #"attachments": [
        #    { "tools": [{"type": "file_search"}] }
        #],
        }
    ]
    )
)

def fill_forms(responses):
    responses = responses
    return "forms are being filled"

# Handle function calls
def handle_form_fill(actions):
    for action in actions["tool_calls"]:
        name = action["function"]["name"]
        arguments = json.loads(action["function"]["arguments"])

        if name == "fill_forms":
            print("FILLING FORMS!")
            return arguments["responses"]

def handle_function_calls(actions, run_id):
    tool_outputs = []
    for action in actions["tool_calls"]:
        name = action["function"]["name"]
        arguments = json.loads(action["function"]["arguments"])
        result = "Failed to handle function"

        if name == "fill_forms":
            print("FILLING FORMS!")
            result = fill_forms(arguments["responses"])

        tool_outputs.append({
                "tool_call_id": action["id"],
                "output": result
            })
    if tool_outputs:
        try:
            run = client.beta.threads.runs.submit_tool_outputs_and_poll(
                thread_id=thread_id,
                run_id=run_id,
                tool_outputs=tool_outputs
            )
            print("Tool outputs submitted successfully.")
            return run, 
        except Exception as e:
            print("Failed to submit tool outputs:", e)
            return None

# Print assistant response
def print_response(run):
    if run and run.status == 'completed':
        messages = client.beta.threads.messages.list(thread_id=thread_id)
        
        print(f"Assistant: {messages.data[0].content[0].text.value}")
    elif run and run.status == "requires_action":
        new_run = handle_function_calls(run.required_action.submit_tool_outputs.model_dump(), run.id)
        if new_run:
            print_response(new_run)
        else:
            print("Failed to process function call response.")
    else:
        print(f"Run status: {run.status if run else 'Run is None'}")

# END ASSISTANT

@app.route('/api/sendprompt', methods=['POST'])
def prompt_llm():
    try:
        # Parse JSON payload from the request
        data = request.json
        id = data.get('id')
        content = data.get('content')

        if not id or not content:
            return jsonify({"error": "Missing required parameters 'id' or 'content'"}), 400

        print("CREATING HELPER PROMPT")
        print(content)
        # Create a message in the thread
        message = client.beta.threads.messages.create(
            thread_id=id,
            role="user",
            content=content
        )

        # Poll for a response
        run = client.beta.threads.runs.create_and_poll(
            thread_id=id,
            assistant_id=assistant_helper.id,
            instructions="Please address the user as Hector."
        )

        # Retrieve the latest messages
        messages = client.beta.threads.messages.list(thread_id=id)
        return jsonify({"messages": messages.data[0].content[0].text.value})

    except Exception as e:
        print("Error processing request:", str(e))
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500


@app.route('/api/helpthread', methods=['POST'])
def createHelperThread():
    print("CREATING HELPER THREAD")
    helper_thread = client.beta.threads.create()
    return jsonify({"id": helper_thread.id})

@app.route('/api/formcall', methods=['POST'])
def form_call():
    try:
        responses = None
        data = request.json
        forms = data.get('forms', [])
        context = data.get('context', "")  # Optional context from the request

        # Log forms for debugging
        print("Forms received:", forms)
        print("Context received:", context)

        # Create a new thread
        newthread = client.beta.threads.create()

        # Assistant logic
        content = (
            f"{forms} Here are the forms. Fill out forms to the best of your ability. "
            f"If there's anything you cannot fill out with the information you have, skip it or fill them out with suggestions. "
            f"The forms information provides the name of the form as well as label or surround text information to give you more context on the purpose of the form. "
            f"Make sure to use your form-filling tool."
        )

        # Append context if provided
        if context:
            content += f" Here's additional context: {context}"

        print("Final content for the assistant:", content)

        # Send the user message to the assistant
        message = client.beta.threads.messages.create(
            thread_id=newthread.id,
            role="user",
            content=content
        )

        # Poll the assistant run
        run = client.beta.threads.runs.create_and_poll(
            thread_id=newthread.id,
            assistant_id=ai_assistant_id,
        )
        print('Run completed:', run.status)

        if run and run.status == "requires_action":
            responses = handle_form_fill(run.required_action.submit_tool_outputs.model_dump())

        # Get the messages and serialize them
        messages = client.beta.threads.messages.list(thread_id=newthread.id)

        # Return the assistant's response and any form suggestions
        return jsonify({
            "messages": messages.data[0].content[0].text.value,
            "responses": responses
        })

    except Exception as e:
        print("Error processing request:", str(e))
        return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

# main driver function
if __name__ == '__main__':

    # run() method of Flask class runs the application 
    # on the local development server.
    app.run()