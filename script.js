document.addEventListener('DOMContentLoaded', () => {
    const dropBtn = document.querySelector('.dropbtn');
    const menu = document.querySelector('.dropdown-menu');
    // The original code had a '.dropdown-content' selector, but no such class was in the HTML.
    // If you intend to use it, ensure an element has this class. Otherwise, it will be null.
    const dropdown = document.querySelector('.dropdown-content');
    const textarea = document.getElementById('codeEditor');

    const mp = {
        "cpp": "cpp.txt",
        "c": "c.txt",
        "python": "python.txt",
        "java": "java.txt",
        "javascript": "javascript.txt",
        "html": "html.txt",
        "css": "css.txt"
    };

    const TAB_SIZE = 4; // Number of spaces for a tab

    // --- Copilot/Suggestion Related Variables ---
    let currentActiveElement = null; // Store the currently focused textarea/editable div
    let ghostSpan = null; // The span element to show suggestions
    let currentSnippet = ""; // The actual suggestion text (diff from current input)
    let fullCode = ""; // The complete code with suggestion applied
    let lastPrompt = ""; // To avoid re-fetching for same input
    let debounceTimer = null; // Timer for delaying API calls
    let focusOutTimer = null; // Timer for debouncing focusout

    // Helper function to get leading spaces
    const getLeadingSpaces = (line) => {
        const match = line.match(/^\s*/);
        return match ? match[0].length : 0;
    };

    // --- Basic HTML Indentation Function (kept as utility, not used on load) ---
    // This function is currently not used anywhere in your provided logic
    // for initial file loading or general formatting. It's a standalone utility.
    function formatHtml(htmlString) {
        let indentLevel = 0;
        let formattedHtml = [];
        const lines = htmlString.split('\n');
        const indentStep = ' '.repeat(TAB_SIZE);

        lines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine.length === 0) {
                formattedHtml.push(''); // Keep blank lines
                return;
            }

            // Check for closing tags first to de-indent before adding the line
            // Matches </tag> or if (trimmedLine.match(/^\s*<\//) || trimmedLine.startsWith('')) {
                indentLevel = Math.max(0, indentLevel - 1);
            }

            formattedHtml.push(indentStep.repeat(indentLevel) + trimmedLine);

            // Check for opening tags to indent for the next line
            // Matches <tag> or <tag attr="value"> but not self-closing <tag/>
            // Excludes common self-closing tags and SVG elements that don't need indentation
            if (trimmedLine.match(/<[a-zA-Z0-9]+[^>]*[^/]>$/) &&
                !trimmedLine.match(/<\/(?!svg|path|g|circle|rect|line|polygon|polyline|ellipse|text|image|foreignObject|use|defs|clipPath|mask|pattern|symbol|marker|view|style|script|title|desc|metadata|filter|feBlend|feColorMatrix|feComponentTransfer|feComposite|feConvolveMatrix|feDiffuseLighting|feDisplacementMap|feFlood|feGaussianBlur|feImage|feMerge|feMorphology|feOffset|feSpecularLighting|feTile|feTurbulence|linearGradient|radialGradient|stop|animate|animateMotion|animateTransform|set|mpath|altGlyph|color-profile|cursor|font|font-face|font-face-format|font-face-name|font-face-src|font-face-uri|hkern|vkern|missing-glyph|tref|altGlyphDef|altGlyphItem|glyph|glyphRef|textPath|tspan|view|a)\s*$/) &&
                !trimmedLine.endsWith('/>')) { // Also explicitly check for /> for self-closing
                indentLevel++;
            }
        });
        return formattedHtml.join('\n');
    }
    // --- END Basic HTML Indentation Function ---


    // Toggle dropdown on button click
    dropBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent click from bubbling to window and closing immediately
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });

    // Hide dropdown if clicked outside
    window.addEventListener('click', (e) => {
        // Check if the click occurred outside both the dropdown button and the menu
        if (!dropBtn.contains(e.target) && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    // Handle language selection
    document.querySelectorAll('.dropdown-menu a').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.preventDefault();
            const lang = item.textContent;
            const id = item.id;
            dropBtn.textContent = lang;

            const fileName = mp[id];
            if (!fileName) return;

            try {
                const res = await fetch(fileName);
                let code = await res.text(); // Get the raw code

                textarea.value = code;
                // After loading new code, trigger an input event to check for new suggestions
                // Or simply call onInput directly as currentActiveElement is set
                onInput();
            } catch (err) {
                console.error("Error loading file:", err);
                textarea.value = `// Failed to load ${fileName}`;
            } finally {
                menu.style.display = 'none'; // Hide dropdown after selection
            }
        });
    });

    // --- Global Event Listeners for Focus ---
    // These ensure that focus changes between *any* elements are tracked
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    // MutationObserver to ensure new elements (if dynamically added) get listeners
    // This is useful if you had other textareas/editable divs being added/removed
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' || mutation.type === 'attributes') {
                if (document.activeElement &&
                    (document.activeElement.tagName === "TEXTAREA" || document.activeElement.getAttribute("contenteditable") === "true") &&
                    document.activeElement !== currentActiveElement) {
                    // If focus is already on a relevant element that just got added/modified
                    handleFocusIn({ target: document.activeElement });
                }
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });


    function handleFocusIn(event) {
        const target = event.target;
        console.log("FocusIn detected. Target:", target);
        if (target.tagName === "TEXTAREA" || target.getAttribute("contenteditable") === "true") {
            // If focus moves to a new monitored element, hide previous suggestion if any
            if (currentActiveElement && currentActiveElement !== target) {
                hideSuggestion();
            }
            currentActiveElement = target;
            setupElementListeners(currentActiveElement);
            onInput(); // Trigger initial suggestion if text exists on focus
        } else {
            // If focus moves out of a monitored element to a non-monitored one
            if (currentActiveElement) {
                console.log("Focus moving out of a monitored element. New target:", target);
                // Using a small delay to distinguish between focus moving within a complex UI element
                if (focusOutTimer) clearTimeout(focusOutTimer);
                focusOutTimer = setTimeout(() => {
                    // Only hide if the new active element is genuinely not part of our UI or is null
                    if (document.activeElement !== currentActiveElement &&
                        (document.activeElement.tagName !== "TEXTAREA" && document.activeElement.getAttribute("contenteditable") !== "true")) {
                        hideSuggestion();
                        currentActiveElement = null; // Clear the reference
                    }
                }, 50); // Short delay
            }
        }
    }

    function handleFocusOut(event) {
        const relatedTarget = event.relatedTarget; // The element that focus is moving TO
        console.log("FocusOut detected. Target:", event.target, "Related Target:", relatedTarget);

        // Clear any pending focusOut timer if focus returns quickly
        if (focusOutTimer) clearTimeout(focusOutTimer);

        focusOutTimer = setTimeout(() => {
            const newActiveElement = document.activeElement;
            console.log("FocusOut timeout checking. New active element:", newActiveElement);

            // If focus genuinely moved outside our editor elements (and not to ghostSpan)
            if (newActiveElement !== currentActiveElement &&
                newActiveElement !== ghostSpan && // Don't hide if focus moves to ghostSpan (though pointer-events:none makes this unlikely)
                (newActiveElement === null || // Focus left the document
                (newActiveElement.tagName !== "TEXTAREA" && newActiveElement.getAttribute("contenteditable") !== "true"))) {
                if (currentActiveElement) { // Ensure we actually had an active element to begin with
                    console.log("True blur detected, clearing active element and hiding suggestion.");
                    hideSuggestion();
                    currentActiveElement = null; // Clear the reference
                }
            }
        }, 150); // Increased delay slightly to 150ms to allow for rapid clicks/focus changes
    }

    function setupElementListeners(element) {
        // Remove existing listeners to prevent duplicates if focus quickly shifts back
        element.removeEventListener("input", onInput);
        element.removeEventListener("keydown", onKeyDown);

        // Add listeners
        element.addEventListener("input", onInput);
        element.addEventListener("keydown", onKeyDown);

        // Create ghostSpan if it doesn't exist
        if (!ghostSpan) {
            ghostSpan = document.createElement('span');
            ghostSpan.className = 'ghost-suggestion'; // Apply a class for styling
            document.body.appendChild(ghostSpan);
        }
        console.log("Copilot listeners set up for current active element:", element);
    }

    // --- Copilot/Suggestion Related Functions ---
    function showSuggestion(snippet) {
        console.log("Attempting to SHOW suggestion:", snippet);
        if (!currentActiveElement || !ghostSpan || !snippet) {
            console.log("SHOW aborted: Missing active element, ghostSpan, or no snippet. currentActiveElement:", currentActiveElement);
            hideSuggestion(); // Ensure it's hidden if conditions aren't met
            return;
        }
        currentSnippet = snippet;
        ghostSpan.textContent = snippet; // Set the ghost text
        ghostSpan.style.display = "block"; // Make it visible
        positionGhostSpan(); // Position it correctly
        console.log("Suggestion should now be visible. GhostSpan textContent:", ghostSpan.textContent);
    }

    function hideSuggestion() {
        console.log("Attempting to HIDE suggestion.");
        if (ghostSpan) {
            ghostSpan.style.display = "none"; // Hide it
            ghostSpan.textContent = ""; // Clear text
        }
        currentSnippet = ""; // Clear snippet
        fullCode = ""; // Clear full code
        lastPrompt = ""; // Reset last prompt
        if (debounceTimer) clearTimeout(debounceTimer); // Clear any pending API calls
        console.log("Suggestion hidden.");
    }

    function positionGhostSpan() {
        if (!currentActiveElement || !ghostSpan) return;

        const textareaRect = currentActiveElement.getBoundingClientRect();
        const textareaStyle = window.getComputedStyle(currentActiveElement);

        // Get padding values
        const paddingTop = parseFloat(textareaStyle.paddingTop);
        const paddingLeft = parseFloat(textareaStyle.paddingLeft);
        const lineHeight = parseFloat(textareaStyle.lineHeight);
        const fontSize = parseFloat(textareaStyle.fontSize);

        // Fallback for lineHeight if it's 'normal' or invalid (e.g., in some contenteditables)
        const actualLineHeight = lineHeight > 0 && !isNaN(lineHeight) ? lineHeight : fontSize * 1.2;

        const cursorPosition = currentActiveElement.selectionStart;
        const textBeforeCursor = currentActiveElement.value.substring(0, cursorPosition);
        const linesBeforeCursor = textBeforeCursor.split('\n');
        const currentLineNumber = linesBeforeCursor.length - 1; // 0-indexed
        const charsOnCurrentLineBeforeCursor = linesBeforeCursor[currentLineNumber].length;

        // Create a temporary element to measure character width accurately
        // This is crucial for monospace fonts where each char has same width.
        // For proportional fonts, this is more complex and might need canvas.
        const tempMeasurer = document.createElement('span');
        tempMeasurer.style.position = 'absolute';
        tempMeasurer.style.visibility = 'hidden';
        tempMeasurer.style.fontFamily = textareaStyle.fontFamily;
        tempMeasurer.style.fontSize = textareaStyle.fontSize;
        tempMeasurer.style.lineHeight = textareaStyle.lineHeight;
        tempMeasurer.style.whiteSpace = 'pre'; // Important: preserves spaces and newlines
        document.body.appendChild(tempMeasurer);

        // Measure the width of the text before the cursor on the current line
        tempMeasurer.textContent = linesBeforeCursor[currentLineNumber];
        const textWidthBeforeCursor = tempMeasurer.offsetWidth;
        document.body.removeChild(tempMeasurer); // Clean up

        // Calculate top position: textarea's top + padding + (line number * line height) - textarea's scrollTop + document scroll
        const top = textareaRect.top + paddingTop + (currentLineNumber * actualLineHeight) - currentActiveElement.scrollTop + window.scrollY;

        // Calculate left position: textarea's left + padding + measured width of text before cursor - textarea's scrollLeft + document scroll
        const left = textareaRect.left + paddingLeft + textWidthBeforeCursor - currentActiveElement.scrollLeft + window.scrollX;

        // Apply styles to ghost span
        ghostSpan.style.top = `${top}px`;
        ghostSpan.style.left = `${left}px`;
        // Constrain to textarea width, considering the starting 'left' position
        ghostSpan.style.maxWidth = `${textareaRect.width - (left - textareaRect.left) - paddingLeft}px`;
        ghostSpan.style.minWidth = '0px';
        ghostSpan.style.minHeight = '0px';
        ghostSpan.style.whiteSpace = "pre-wrap"; // Ensure line breaks are respected
        ghostSpan.style.wordBreak = "break-word";
        ghostSpan.style.fontFamily = textareaStyle.fontFamily;
        ghostSpan.style.fontSize = textareaStyle.fontSize;
        ghostSpan.style.lineHeight = textareaStyle.lineHeight;
        ghostSpan.style.padding = '0'; // No padding for ghost span itself
        ghostSpan.style.border = 'none'; // No border
        ghostSpan.style.background = 'transparent'; // Transparent background
        ghostSpan.style.pointerEvents = "none"; // Crucial so it doesn't interfere with clicks
        ghostSpan.style.opacity = "0.4";
        ghostSpan.style.color = "#999";
        ghostSpan.style.zIndex = "9999";
    }

    // `acceptSuggestion` is now directly integrated into `onKeyDown` for robustness.
    // Keeping it here for clarity, but its core logic is copied to `onKeyDown`.
    function acceptSuggestion() {
        if (!currentActiveElement || !fullCode) return; // Should not be called directly often anymore

        const originalScrollTop = currentActiveElement.scrollTop;
        const originalScrollLeft = currentActiveElement.scrollLeft;

        currentActiveElement.value = fullCode;
        currentActiveElement.selectionStart = currentActiveElement.selectionEnd = fullCode.length;

        currentActiveElement.scrollTop = originalScrollTop;
        currentActiveElement.scrollLeft = originalScrollLeft;

        hideSuggestion();
    }

    function onInput() {
        if (!currentActiveElement) {
            console.log("onInput: Aborting, currentActiveElement:", currentActiveElement);
            hideSuggestion();
            return;
        }

        if (debounceTimer) clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {
            if (!currentActiveElement) {
                console.log("onInput debounced: currentActiveElement is null, aborting fetch.");
                hideSuggestion();
                return;
            }

            const fullInput = currentActiveElement.tagName === "TEXTAREA" ? currentActiveElement.value : currentActiveElement.innerText;

            // Only fetch if input has changed and is not empty after trimming
            if (fullInput.trim() === "" || fullInput === lastPrompt) {
                console.log("Input unchanged or empty, skipping fetch.");
                return;
            }

            lastPrompt = fullInput;
            console.log("Fetching suggestion for:", fullInput);
            fetchSuggestion(fullInput);
        }, 500); // Debounce API calls by 500ms
    }

    async function fetchSuggestion(prompt) {
        if (!currentActiveElement) {
            console.error("fetchSuggestion: currentActiveElement is null at the start, cannot fetch.");
            hideSuggestion();
            return;
        }

        try {
            const res = await fetch("/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: prompt })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(`Server error: ${res.status} - ${errorData.error || res.statusText}`);
            }

            const { snippet, fullCode: full } = await res.json();
            console.log("Received suggestion - Snippet:", snippet, "FullCode:", full);

            // Re-check currentActiveElement in case focus changed during async fetch
            if (!currentActiveElement) {
                console.warn("currentActiveElement became null after fetch, discarding suggestion.");
                hideSuggestion();
                return;
            }

            // Verify that the input hasn't changed since the request was sent
            const currentInputContent = currentActiveElement.tagName === "TEXTAREA" ? currentActiveElement.value : currentActiveElement.innerText;
            if (currentInputContent === prompt) { // Check if the current input still matches the prompt we sent
                if (snippet && full) {
                    fullCode = full; // Store the full code for acceptance
                    showSuggestion(snippet); // Show only the snippet
                } else {
                    hideSuggestion();
                    console.log("No valid snippet or fullCode received, hiding suggestion.");
                }
            } else {
                console.log("Input changed during fetch, discarding old suggestion.");
                hideSuggestion();
            }
        } catch (err) {
            console.error("Error fetching suggestion:", err);
            hideSuggestion();
        }
    }

    function onKeyDown(e) {
        // This 'this' refers to the textarea element due to the event listener context
        const start = this.selectionStart;
        const end = this.selectionEnd;
        const value = this.value; // Current value of the editor

        if (!currentActiveElement) return; // Ensure currentActiveElement is set

        // --- Tab Key Handling (Prioritize Shift + Tab) ---
        if (e.key === "Tab") {
            e.preventDefault(); // Always prevent default tab behavior for our custom handling

            if (e.shiftKey) {
                console.log("Shift+Tab pressed: De-indenting.");
                const lines = value.substring(0, start).split('\n');
                const currentLineIndex = lines.length - 1;
                const currentLineStart = start - lines[currentLineIndex].length;
                const line = value.substring(currentLineStart, start); // Get current line up to cursor

                let deIndentedValue = value;
                let newCursorPosition = start;

                if (start !== end) { // If text is selected, de-indent all selected lines
                    const selectedText = value.substring(start, end);
                    const selectedLines = selectedText.split('\n');
                    const newSelectedLines = selectedLines.map(line => {
                        if (line.startsWith(' '.repeat(TAB_SIZE))) {
                            return line.substring(TAB_SIZE);
                        }
                        return line;
                    });
                    deIndentedValue = value.substring(0, start) + newSelectedLines.join('\n') + value.substring(end);
                    // Adjust cursor position based on how much was de-indented from the start of selection
                    newCursorPosition = start;
                    for (let i = 0; i < selectedLines.length; i++) {
                        if (selectedLines[i].startsWith(' '.repeat(TAB_SIZE))) {
                            newCursorPosition -= TAB_SIZE;
                        }
                    }
                    newCursorPosition = Math.max(start - (selectedText.length - newSelectedLines.join('\n').length), 0); // Ensure not negative
                } else { // If no text is selected, de-indent the current line
                    if (line.startsWith(' '.repeat(TAB_SIZE))) {
                        deIndentedValue = value.substring(0, currentLineStart) + line.substring(TAB_SIZE) + value.substring(start);
                        newCursorPosition = start - TAB_SIZE;
                    }
                }
                this.value = deIndentedValue + value.substring(start); // Reassemble
                this.selectionStart = this.selectionEnd = newCursorPosition;

            } else if (currentSnippet && fullCode) { // If a Copilot suggestion exists and full code is ready
                console.log("Tab pressed: Accepting Copilot suggestion.");
                const originalScrollTop = this.scrollTop;
                const originalScrollLeft = this.scrollLeft;

                this.value = fullCode; // Directly apply the full suggested code
                this.selectionStart = this.selectionEnd = fullCode.length; // Move cursor to the end

                this.scrollTop = originalScrollTop; // Restore scroll position
                this.scrollLeft = originalScrollLeft;

                hideSuggestion(); // Hide the ghost text
                console.log("Suggestion accepted. New value length:", this.value.length);
            } else {
                console.log("Tab pressed: No Copilot suggestion, performing manual indentation.");
                const indentation = ' '.repeat(TAB_SIZE);
                this.value = value.substring(0, start) + indentation + value.substring(end);
                this.selectionStart = this.selectionEnd = start + TAB_SIZE;
            }
            return; // Important: Exit after handling Tab in all cases
        }

        // Handle ArrowRight for Copilot acceptance (only if suggestion exists and cursor is at end of text)
        if (e.key === "ArrowRight" && currentSnippet) {
            const currentText = currentActiveElement.tagName === "TEXTAREA" ? currentActiveElement.value : currentActiveElement.innerText;
            const cursorPosition = currentActiveElement.selectionStart;

            // Check if cursor is at the very end of the *current content* (before suggestion)
            if (cursorPosition === currentText.length) {
                e.preventDefault();
                console.log("ArrowRight pressed at end of line: Accepting Copilot suggestion.");
                // Directly apply the logic here as well for consistency with Tab
                const originalScrollTop = this.scrollTop;
                const originalScrollLeft = this.scrollLeft;

                this.value = fullCode;
                this.selectionStart = this.selectionEnd = fullCode.length;

                this.scrollTop = originalScrollTop;
                this.scrollLeft = originalScrollLeft;

                hideSuggestion();
            }
            return; // Exit after handling ArrowRight
        }

        // Handle Escape to hide suggestion
        if (e.key === "Escape") {
            console.log("Escape pressed: Hiding Copilot suggestion.");
            hideSuggestion();
            return; // Exit after handling Escape
        }

        // --- Editor Logic for Indentation and Auto-Closing Brackets (Non-Copilot specific keydowns) ---

        // Handle Enter key for auto-indentation (general code logic)
        else if (e.key === 'Enter') {
            e.preventDefault();
            console.log("Enter pressed: Auto-indenting.");

            const lines = value.substring(0, start).split('\n');
            const currentLine = lines[lines.length - 1];
            let leadingSpaces = getLeadingSpaces(currentLine);

            const trimmedCurrentLine = currentLine.trimEnd();
            const lastChar = trimmedCurrentLine.charAt(trimmedCurrentLine.length - 1);

            // HTML-specific indentation after '>'
            // This is a simplified check. A more robust HTML parser would be needed for complex cases.
            const textBeforeCursorOnLine = currentLine.substring(0, start - (value.lastIndexOf('\n', start - 1) + 1));
            if (lastChar === '>' && textBeforeCursorOnLine.trim().endsWith('>')) {
                leadingSpaces += TAB_SIZE; // Increase indent if previous line ended with '>'
            } else if (lastChar === '{' || lastChar === '(' || lastChar === '[' || lastChar === ':') {
                leadingSpaces += TAB_SIZE;
            }

            this.value = value.substring(0, start) + '\n' + ' '.repeat(leadingSpaces) + value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1 + leadingSpaces;
            return; // Exit after handling Enter
        }
        // Handle auto-de-indentation for closing braces/brackets/parentheses
        else if (e.key === '}' || e.key === ')' || e.key === ']') {
            if (start === end) { // Only apply if no text is selected
                const lines = value.substring(0, start).split('\n');
                const currentLine = lines[lines.length - 1];
                const prevLine = lines[lines.length - 2] || ''; // Get previous line

                const currentLineLeadingSpaces = getLeadingSpaces(currentLine);
                const prevLineLeadingSpaces = getLeadingSpaces(prevLine);

                const trimmedPrevLine = prevLine.trimEnd();
                const prevLastChar = trimmedPrevLine.charAt(trimmedPrevLine.length - 1);

                // Conditions for de-indenting:
                // 1. Current line has more indentation than the previous line.
                // 2. The previous line did NOT end with an opening brace/bracket/paren (which would imply auto-indent was correct).
                const shouldDeIndent = (currentLineLeadingSpaces > prevLineLeadingSpaces) &&
                                         !(prevLastChar === '{' || prevLastChar === '(' || prevLastChar === '[');

                if (shouldDeIndent) {
                    e.preventDefault();
                    console.log(`Typing ${e.key}: Auto-de-indenting.`);
                    const newLeadingSpaces = Math.max(0, currentLineLeadingSpaces - TAB_SIZE);
                    const deIndentedLine = ' '.repeat(newLeadingSpaces) + currentLine.trimStart();

                    // Reconstruct value: part before current line + de-indented line + typed char + part after cursor
                    this.value = value.substring(0, start - currentLine.length) + deIndentedLine + e.key + value.substring(end);
                    // Adjust cursor position: original start + 1 (for the typed char) - (difference in leading spaces)
                    this.selectionStart = this.selectionEnd = start + 1 - (currentLineLeadingSpaces - newLeadingSpaces);
                }
            }
            return; // Exit after handling closing brackets
        }
        // Handle auto-closing brackets, parentheses, and braces
        else if (e.key === '(' || e.key === '{' || e.key === '[') {
            e.preventDefault();
            console.log(`Typing ${e.key}: Auto-closing counterpart.`);

            let closingChar = '';
            if (e.key === '(') closingChar = ')';
            else if (e.key === '{') closingChar = '}';
            else if (e.key === '[') closingChar = ']';

            // Insert opening char, then closing char, then the rest of the text
            this.value = value.substring(0, start) + e.key + closingChar + value.substring(end);
            // Place cursor between the new opening and closing chars
            this.selectionStart = this.selectionEnd = start + 1;
            return; // Exit after handling opening brackets
        }
    }

    // Optional: Adjust height based on content
    // textarea.addEventListener('input', () => {
    //     textarea.style.height = 'auto';
    //     textarea.style.height = (textarea.scrollHeight) + 'px';
    // });

    // Initial setup for the textarea since it's present on load
    if (textarea) {
        currentActiveElement = textarea;
        setupElementListeners(textarea);
        // Do not call onInput() immediately here if you want to wait for user input
        // or a loaded file. Calling it now would trigger a fetch on an empty editor.
        // It's already called in handleFocusIn or after file load.
    }
});
