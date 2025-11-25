import os
from google import genai
from google.genai import types

# --- 1. Define Nexus's Persona (Same as Step 2) ---
SYSTEM_INSTRUCTION = """
You are 'Nexus', a highly professional, proactive, and confidential AI assistant for Meg.

ROLE: Your primary function is to manage tasks, summarize technical documents, 
and execute code or actions (via provided tools). You must prioritize efficiency 
and clarity in all responses. You have access to a tool to read project documents. 
You MUST use the 'read_project_document' tool whenever a query requires looking 
up specific details from a project file.

TONE: Formal, succinct, and always helpful. Do not use emojis, unnecessary pleasantries, 
or excessive enthusiasm. Get straight to the point.

CONFIDENTIALITY: All information provided to you, especially concerning Meg's projects 
and professional life, is strictly confidential.

ACTIONS: When asked to perform a task, acknowledge the request and confirm the action.
"""

# --- 2. Define the Custom Tool (The RAG Function) ---

def read_project_document(filename: str) -> str:
    """Reads the content of a project document from the local file system. 
    Returns the content as a string.
    """
    base_path = "C:\\nexus"  # Define the base directory for security
    full_path = os.path.join(base_path, filename)
    
    # Safety check to ensure the file is in the expected directory
    if not full_path.startswith(base_path):
        return f"Error: Access denied. Cannot read file outside {base_path}."

    try:
        with open(full_path, 'r') as f:
            content = f.read()
        return content
    except FileNotFoundError:
        return f"File '{filename}' not found in the project directory."
    except Exception as e:
        return f"An error occurred while reading the file: {e}"

# --- 3. Initialize the Client and Configuration ---
try:
    client = genai.Client()
except Exception:
    print("Error: GEMINI_API_KEY environment variable not set.")
    exit()

# Configure the model to recognize and use the custom function
config = types.GenerateContentConfig(
    system_instruction=SYSTEM_INSTRUCTION,
    tools=[read_project_document], # Register the function here
    temperature=0.3 
)

model_name = 'gemini-2.5-flash'

# --- 4. Start the Persistent Chat Session ---
try:
    chat = client.chats.create(
        model=model_name,
        config=config,
    )
    print("--- Nexus AI Assistant Initiated (RAG Active) ---")
    print(f"Chat session started with {model_name}. Type 'exit' to quit.\n")
except Exception as e:
    print(f"Error starting chat session: {e}")
    exit()

# --- 5. The Interactive Chat Loop (Handles Function Calls) ---
while True:
    user_input = input("Meg: ")

    if user_input.lower() in ['exit', 'quit']:
        print("\nNexus: Session terminated. Have a productive day, Meg.")
        break
    
    if not user_input.strip():
        continue

    # Send the user message to the chat
    response = chat.send_message(user_input)
    
    # --- Function Calling Logic ---
    while response.function_calls:
        # Nexus wants to call a function (tool)
        function_calls = response.function_calls
        
        tool_results = []
        for call in function_calls:
            function_name = call.name
            args = dict(call.args)
            
            # Execute the function based on its name
            if function_name == 'read_project_document':
                # Dynamically call the Python function
                result_content = read_project_document(**args)
                
                # Create the ToolResult object to send back to the model
                tool_results.append(types.Part.from_tool_function_result(
                    name=function_name,
                    result=result_content
                ))
            else:
                # Handle unknown function calls
                tool_results.append(types.Part.from_tool_function_result(
                    name=function_name,
                    result=f"Error: Unknown tool {function_name}"
                ))
        
        # Send the tool results back to the model so it can formulate the final answer
        response = chat.send_message(tool_results)

    # Print the final text response from Nexus
    print(f"Nexus: {response.text.strip()}")