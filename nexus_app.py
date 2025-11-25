import os
import streamlit as st
from google import genai
from google.genai import types
import json 

# --- 1. Define Nexus's Persona and RAG Tool ---

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

def read_project_document(filename: str) -> str:
    """Reads the content of a project document from the local file system. 
    Returns the content as a string.
    """
    # NOTE: The base_path is set to C:\nexus, matching the user's environment.
    base_path = "C:\\nexus"
    full_path = os.path.join(base_path, filename)
    
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

# --- 2. Streamlit Setup and Initialization ---

st.set_page_config(page_title="Nexus: Meg's Executive Assistant", layout="wide")
st.title("🤝 Nexus: Meg's Executive Assistant")
st.caption("Custom AI powered by Gemini and local RAG.")

# --- 3. Initialize Session State ---

if "client" not in st.session_state:
    try:
        # Client initialization only runs once
        # NOTE: This relies on the GEMINI_API_KEY environment variable being set in PowerShell
        st.session_state.client = genai.Client()
    except Exception:
        st.error("Error: GEMINI_API_KEY environment variable not set. Please set the key.")
        st.stop()

if "chat" not in st.session_state:
    # Configuration setup
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[read_project_document], # Register the function
        temperature=0.3
    )
    
    # Start the persistent chat session
    st.session_state.chat = st.session_state.client.chats.create(
        model='gemini-2.5-flash',
        config=config,
    )
    # Initial greeting message
    st.session_state.messages = [{"role": "Nexus", "content": "Hello Meg. Nexus is ready for your command."}]

# --- 4. Display Chat History ---

for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# --- 5. Handle User Input and Function Calling (REVISED NON-STREAMING) ---

if user_input := st.chat_input("Enter your command for Nexus..."):
    # Add user message to history and display
    st.session_state.messages.append({"role": "Meg", "content": user_input})
    with st.chat_message("Meg"):
        st.markdown(user_input)

    with st.chat_message("Nexus"):
        # Send user message - NON-STREAMING (synchronous)
        # This fixes the TypeError: Chat.send_message() got an unexpected keyword argument 'stream'
        response = st.session_state.chat.send_message(user_input) 
        
        # --- Function Calling Logic ---
        while response.function_calls:
            function_calls = response.function_calls
            
            tool_results = []
            for call in function_calls:
                function_name = call.name
                args = dict(call.args)
                
                # Execute the function
                if function_name == 'read_project_document':
                    result_content = read_project_document(**args)
                    
                    tool_results.append(types.Part.from_tool_function_result(
                        name=function_name,
                        result=result_content
                    ))
                    # Displaying tool usage status in the chat interface
                    st.info(f"Nexus is accessing local file: `{args.get('filename', 'Unknown File')}`")

            # Send tool results back to the model for the final answer
            response = st.session_state.chat.send_message(tool_results)

        # Print the final text response from Nexus
        response_text = response.text.strip()
        st.markdown(response_text)
        
        # Save the final response to the history
        st.session_state.messages.append({"role": "Nexus", "content": response_text})