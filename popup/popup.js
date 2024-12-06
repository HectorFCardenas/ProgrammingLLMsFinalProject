document.addEventListener("DOMContentLoaded", () => {
    const chatContainer = document.getElementById("chatContainer");
    const sendButton = document.getElementById("sendButton");
    const userInput = document.getElementById("userInput");

    let threadId = null;

    // Fetch or reset the thread ID on popup open
    chrome.runtime.sendMessage({ type: "resetThread" }, (response) => {
        console.log("Received response from background script:", response);

        if (chrome.runtime.lastError) {
            console.error("Runtime error:", chrome.runtime.lastError.message);
            addMessage("Error resetting the thread. Please try again later.", "assistant", true);
            return;
        }

        if (response && response.status === "processing") {
            console.log("Thread reset is processing. Waiting for final thread ID...");
        } else if (response && response.threadId) {
            threadId = response.threadId;
            console.log("Thread reset. Using new thread ID:", threadId);
        } else if (response && response.error) {
            console.error("Error resetting thread:", response.error);
            addMessage(`Error resetting the thread: ${response.error}`, "assistant", true);
        } else {
            console.error("Unexpected response format:", response);
            addMessage("Error resetting the thread. Please try again later.", "assistant", true);
        }
    });

    // Function to add a message to the thread
    function addMessage(content, sender, isError = false) {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message", sender);
        if (isError) {
            messageDiv.classList.add("error");
        }

        const bubble = document.createElement("div");
        bubble.classList.add("bubble", sender);
        bubble.textContent = content;

        messageDiv.appendChild(bubble);
        chatContainer.appendChild(messageDiv);

        // Scroll to the bottom of the chat container
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("Received message from background script:", message);

        if (message.threadId) {
            threadId = message.threadId;
            console.log("Thread reset complete. New thread ID:", threadId);
            addMessage("Thread reset successfully.", "assistant");
        } else if (message.error) {
            console.error("Error from background script:", message.error);
            addMessage(`Error resetting thread: ${message.error}`, "assistant", true);
        } else {
            console.error("Unexpected message format:", message);
        }
    });

    // Handle user input
    sendButton.addEventListener("click", () => {
        if (!threadId) {
            console.error("Thread ID is not available.");
            addMessage("Error: Unable to send message. Thread ID is missing.", "assistant", true);
            return;
        }

        const query = userInput.value.trim();
        if (!query) {
            return; // Don't send empty messages
        }

        addMessage(query, "user");
        userInput.value = ""; // Clear the input field

        // Send message to background script to communicate with the assistant
        chrome.runtime.sendMessage(
            { type: "addMessage", threadId, content: query },
            (response) => {
                console.log("Received response for query:", response);

                if (chrome.runtime.lastError) {
                    console.error("Runtime error:", chrome.runtime.lastError.message);
                    addMessage("Error communicating with the assistant. Please try again.", "assistant", true);
                    return;
                }

                if (response && response.status === "success") {
                    const assistantMessage = response.response?.messages || "Unexpected response from the assistant.";
                    addMessage(assistantMessage, "assistant");
                } else if (response && response.error) {
                    console.error("Error from assistant:", response.error);
                    addMessage(`Error: ${response.error}`, "assistant", true);
                } else {
                    console.error("Unexpected response format:", response);
                    addMessage("Error: Unexpected response from assistant.", "assistant", true);
                }
            }
        );
    });
});
