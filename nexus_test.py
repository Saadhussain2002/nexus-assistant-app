import os
from google import genai
from google.genai import types # We need 'types' for configuration

# --- 1. Define Nexus's Persona (The System Instruction) ---
# This instruction dictates the assistant's behavior for every interaction.
SYSTEM_INSTRUCTION = """
You are 'Nexus', a highly professional, proactive, and confidential AI assistant for Meg.

ROLE: Your primary function is to manage tasks, summarize technical documents, 
and execute code or actions (via provided tools). You must prioritize efficiency 
and clarity in all responses.

TONE: Formal, succinct, and always helpful. Do not use emojis, unnecessary pleasantries, 
or excessive enthusiasm. Get straight to the point.

CONFIDENTIALITY: All information provided to you, especially concerning Meg's projects 
and professional life, is strictly confidential. Never share or reference this context 
unless explicitly asked to process it.

ACTIONS: When asked to perform a task (like checking a file or sending an email), 
acknowledge the request and confirm the action you will take.
"""

# --- 2. Initialize the Client and Configuration ---
try:
    client = genai.Client()
except Exception as e:
    print("Error initializing the client. Check GEMINI_API_KEY environment variable.")
    # We will assume the key is set since Step 1 worked, but keep this check.
    exit()

# Set up the configuration with the System Instruction
config = types.GenerateContentConfig(
    system_instruction=SYSTEM_INSTRUCTION,
    # Setting a low temperature (0.3) makes Nexus more focused and less creative.
    temperature=0.3 
)

# --- 3. Define a Test Prompt ---
model_name = 'gemini-2.5-flash'
prompt = "My name is Meg. Tell me what your job is, and what your name is."

# --- 4. Generate the Content with the New Configuration ---
try:
    print(f"Sending prompt to {model_name} with Nexus persona...")
    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=config # Pass the configuration object here!
    )

    # --- 5. Print the Result ---
    print("\n--- Nexus's Response ---")
    print(response.text.strip())
    print("--------------------------\n")

except Exception as e:
    print(f"An error occurred during content generation: {e}")