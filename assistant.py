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
        {"type": "file_search"},
        {
            "type": "function",
            "function": {
                "name": "fill_forms",
                "description": "Fill in forms entries. Remember that you might have access to files that can help you make informed responses.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "responses": {
                            "type": "string",
                            "items": {"type": "string"},
                            "description": "A list of strings of the email addresses of the people to invite to the meeting."
                        }
                    },
                    "required": ["friend_email_address", "subject", "body","private"]
                }
            }
        }
    ],
    model=model,
)

thread = client.beta.threads.create()
ai_assistant_id = assistant.id
thread_id = thread.id
print("Thread ID:", thread_id)
print("Assistant ID:", ai_assistant_id)

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

def form_call(forms):
    message = client.beta.threads.messages.create(
        thread_id=thread_id,
        role="user",
        content="Fill out of the following forms: "+str(forms)
    )

    # Run the assistant
    client.beta.threads.runs.create_and_poll(
        thread_id=thread_id,
        assistant_id=ai_assistant_id,
        #instructions="Address me as Hector. Ask questions if you need more information."
    )

# Handle function calls
def handle_function_calls(actions, run_id):
    tool_outputs = []
    for action in actions["tool_calls"]:
        name = action["function"]["name"]
        arguments = json.loads(action["function"]["arguments"])
        result = "Failed to handle function"

        if name == "fill_forms":
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
            #print("Tool outputs submitted successfully.")
            return run
        except Exception as e:
            #print("Failed to submit tool outputs:", e)
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

# Main conversation loop
def main():
    while True:
        user_input = input("You: ")
        if user_input.lower() in ["exit", "quit"]:
            print("Ending conversation.")
            break

        # Send message to the assistant
        message = client.beta.threads.messages.create(
            thread_id=thread_id,
            role="user",
            content=user_input
        )

        # Run the assistant
        run = client.beta.threads.runs.create_and_poll(
            thread_id=thread_id,
            assistant_id=ai_assistant_id,
            instructions="Address me as Hector. Ask questions if you need more information."
        )

        # Print the assistant's response
        print_response(run)

# Start the conversation
#main()
