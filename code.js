
/**
 * ### Description:
 * This function is an immediately invoked wrapper that builds and runs the whole RPN calculator. It sets up the
 * calculator state, the display, the keypad and keyboard handling, the on-screen scaling, and the install/offline
 * (PWA) support, then loads saved settings and draws the first screen.
 *
 * ### Returns:
 * - Nothing. The function runs once as soon as the script loads.
 *
 * ### Notes:
 * - Nothing is exported, so all of the calculator's helpers stay private to this wrapper.
 * - The number stack is not saved between visits. Only the memory slots, the number mode, and the angle unit persist.
 */
(function () {

    // Initial setup and declarations. ----------------------------------------

    // Define the numeric base used for each number mode.
    const BASE = {DEC: 10, HEX: 16, BIN: 2};

    // Define the maximum number of digits that can be typed in each number mode.
    const LIMIT = {DEC: 15, HEX: 13, BIN: 53};

    // Define the number modes in the order the keyboard cycles through them.
    const MODES = ['DEC', 'HEX', 'BIN'];

    // Define the browser storage key used to save the memory slots and settings.
    const SAVE_KEY = 'rpn4-memory';

    // Create the calculator state, which holds everything that changes while the calculator is used.
    const state = {
        stack: [],
        entry: null,
        msg: '',
        mode: 'DEC',
        mem: [null, null, null, null],
        armed: false,
        angle: 'DEG',
        inv: false
    };

    /**
     * ### Description:
     * This function looks up a page element by its id.
     *
     * ### Parameters:
     * - `id`: A string representing the id of the element to find.
     *
     * ### Returns:
     * - An element representing the page element with the given id.
     * - If no element has that id, the function returns null.
     */
    const $ = (id) => document.getElementById(id);

    // Collect the display rows, message areas, and keypad into one lookup object.
    const el = {
        T: $('rT'),
        Z: $('rZ'),
        Y: $('rY'),
        X: $('rX'),
        msg: $('msg'),
        depth: $('depth'),
        modeTag: $('modeTag'),
        keys: $('keys')
    };

    // Find the four memory buttons.
    const memBtns = [0, 1, 2, 3].map(i => document.querySelector('[data-k="mem' + i + '"]'));

    // Find the scientific buttons that are disabled outside DEC mode.
    const sciBtns = ['inv', 'sin', 'cos', 'tan', 'pi'].map(k => document.querySelector('[data-k="' + k + '"]'));

    // Find every button that types a digit or a decimal point.
    const digitBtns = Array.from(document.querySelectorAll('[data-k]')).filter(b => /^[0-9A-F.]$/.test(b.dataset.k));

    /**
     * ### Description:
     * This function loads the saved memory slots, number mode, and angle unit from browser storage into the calculator
     * state. Any saved value that is missing or invalid is ignored, so the calculator keeps its default for it.
     *
     * ### Returns:
     * - Nothing. The function updates the calculator state directly.
     *
     * ### Notes:
     * - Memory, mode, and angle unit persist in this browser, but the stack does not.
     * - If storage is unavailable or the saved data cannot be read, the calculator starts fresh.
     */
    function load() {

        // Try to read the saved data, as storage can be blocked or hold bad data.
        try {

            // Read and parse the saved data, or use null if nothing was saved.
            const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');

            // If the saved memory is an array of four slots...
            if (d && Array.isArray(d.mem) && d.mem.length === 4) {

                // Keep each slot only if it is a finite number, otherwise mark the slot as empty.
                state.mem = d.mem.map(v => (typeof v === 'number' && isFinite(v)) ? v : null);
            }

            // If the saved number mode is a known mode, restore it.
            if (d && BASE[d.mode]) state.mode = d.mode;

            // If the saved angle unit is degrees or radians, restore it.
            if (d && (d.angle === 'DEG' || d.angle === 'RAD')) state.angle = d.angle;
        }
        catch (e) {

            // Storage is unavailable, so start fresh.
        }
    }

    /**
     * ### Description:
     * This function saves the memory slots, number mode, and angle unit to browser storage.
     *
     * ### Returns:
     * - Nothing. If storage is unavailable, the function quietly does nothing.
     */
    function save() {

        // Try to write the data, as storage can be blocked or full.
        try {

            // Save the memory slots, number mode, and angle unit as one JSON string.
            localStorage.setItem(SAVE_KEY, JSON.stringify({mem: state.mem, mode: state.mode, angle: state.angle}));
        }
        catch (e) {

            // Storage is unavailable, so skip saving.
        }
    }

    /**
     * ### Description:
     * This function reports whether the calculator is in an integer-only mode (HEX or BIN).
     *
     * ### Returns:
     * - A boolean that is true when the current mode is not DEC, and false when it is DEC.
     */
    const isInt = () => state.mode !== 'DEC';

    /**
     * ### Description:
     * This function inserts a space between each group of four binary digits, counting from the right.
     *
     * ### Parameters:
     * - `s`: A string representing a number written in binary digits (0 and 1), with an optional leading minus sign.
     *
     * ### Returns:
     * - A string representing the same digits, with a space between each group of four.
     */
    const group4 = (s) => s.replace(/\B(?=([01]{4})+(?![01]))/g, ' ');

    /**
     * ### Description:
     * This function formats a number as decimal text for the display, using exponent form for very large and very
     * small values.
     *
     * ### Parameters:
     * - `v`: A number representing the value to format.
     *
     * ### Returns:
     * - A string representing the value with up to 12 significant digits.
     * - If the value is non-zero and its size is at least 1e12 or below 1e-9, the string is in exponent form with up to
     *   eight decimals, and trailing zeros are removed.
     * - If the value is negative zero, the function formats it as zero.
     */
    function fmtDec(v) {

        // Treat negative zero as plain zero so the display never shows "-0".
        if (Object.is(v, -0)) v = 0;

        // Get the size of the value, ignoring its sign.
        const a = Math.abs(v);

        // If the value is non-zero and very large or very small, use exponent form with trailing zeros removed.
        if (a !== 0 && (a >= 1e12 || a < 1e-9)) return v.toExponential(8).replace(/\.?0+e/, 'e');

        // Otherwise round to 12 significant digits and convert to text, which drops any trailing zeros.
        return String(Number(v.toPrecision(12)));
    }

    /**
     * ### Description:
     * This function writes the whole-number part of a value in the current base, using capital letters for HEX digits
     * and no grouping.
     *
     * ### Parameters:
     * - `v`: A number representing the value to write. Any fraction is dropped.
     *
     * ### Returns:
     * - A string representing the whole-number part of the value in the current base, with a leading minus sign when
     *   the truncated value is below zero.
     */
    function rawInt(v) {

        // Drop the fractional part of the value.
        const t = Math.trunc(v);

        // Build the text from the sign and the digits of the absolute value in the current base.
        return (t < 0 ? '-' : '') + Math.abs(t).toString(BASE[state.mode]).toUpperCase();
    }

    /**
     * ### Description:
     * This function formats a value for display in the current number mode.
     *
     * ### Parameters:
     * - `v`: A number representing the value to format.
     *
     * ### Returns:
     * - A string representing the value as decimal text in DEC mode.
     * - In HEX mode, the string holds the whole-number part in hexadecimal.
     * - In BIN mode, the string holds the whole-number part in binary, with a space between each group of four digits.
     */
    function fmt(v) {

        // If the calculator is in DEC mode, format the value as decimal text.
        if (!isInt()) return fmtDec(v);

        // Write the whole-number part in the current base.
        const s = rawInt(v);

        // Group binary digits in fours for readability, and leave hexadecimal digits as they are.
        return state.mode === 'BIN' ? group4(s) : s;
    }

    /**
     * ### Description:
     * This function builds the plain text used when a value on the stack is pulled back into the entry line to be
     * edited.
     *
     * ### Parameters:
     * - `v`: A number representing the value to turn into editable text.
     *
     * ### Returns:
     * - A string representing the value with no grouping, in the current base for HEX and BIN modes.
     * - In DEC mode, a value that would normally show in exponent form is written out in full, with up to 20 decimals.
     */
    function editString(v) {

        // If the calculator is in HEX or BIN mode, return the whole-number text without grouping.
        if (isInt()) return rawInt(v);

        // Format the value as decimal text.
        let s = fmtDec(v);

        // If the text is in exponent form, rewrite it as a plain number, as an entry line cannot hold an exponent.
        if (/e/.test(s)) s = v.toLocaleString('en-US', {useGrouping: false, maximumFractionDigits: 20});

        // Return the editable text.
        return s;
    }

    /**
     * ### Description:
     * This function records an error message to show on the display.
     *
     * ### Parameters:
     * - `text`: A string representing the message to show.
     *
     * ### Returns:
     * - Always null, so callers can return the result directly to signal that an operation failed.
     */
    function fail(text) {

        // Save the message so the next render shows it.
        state.msg = text;

        // Return null to signal failure.
        return null;
    }

    /**
     * ### Description:
     * This function converts the text typed on the entry line into a number, using the current number mode.
     *
     * ### Parameters:
     * - `e`: A string representing the entry line text, with an optional leading minus sign.
     *
     * ### Returns:
     * - A number representing the typed value, parsed as an integer in the current base in HEX and BIN modes, or as a
     *   decimal number in DEC mode.
     * - If the text has no digits (it is empty or only a decimal point), the function returns null.
     * - If the text cannot be read as a number, the function returns null.
     */
    function parseEntry(e) {

        // Check whether the entry starts with a minus sign.
        const neg = e.startsWith('-');

        // Get the part of the entry after any minus sign.
        const body = neg ? e.slice(1) : e;

        // If there are no digits to read, return null.
        if (body === '' || body === '.') return null;

        // Parse the digits as an integer in the current base, or as a decimal number in DEC mode.
        const v = isInt() ? parseInt(body, BASE[state.mode]) : parseFloat(body);

        // If the text did not produce a number, return null.
        if (isNaN(v)) return null;

        // Apply the sign and return the value.
        return neg ? -v : v;
    }

    /**
     * ### Description:
     * This function finishes the number being typed by converting it to a value and pushing it onto the stack. The
     * entry line is cleared whether or not the text could be read as a number.
     *
     * ### Returns:
     * - Nothing. If there is no entry in progress, the function does nothing.
     */
    function commitEntry() {

        // If no number is being typed, there is nothing to commit.
        if (state.entry === null) return;

        // Convert the typed text into a number.
        const v = parseEntry(state.entry);

        // Clear the entry line.
        state.entry = null;

        // If the text produced a valid number, push it onto the stack.
        if (v !== null) state.stack.push(v);
    }

    /**
     * ### Description:
     * This function checks that the stack holds at least a given number of values, and sets an error message when it
     * does not.
     *
     * ### Parameters:
     * - `n`: A number representing how many values the stack must hold (usually 1 or 2).
     *
     * ### Returns:
     * - A boolean that is true when the stack holds at least `n` values.
     * - If the stack is too short, the function sets the message to "Stack is empty" (when `n` is 1) or
     *   "Needs n numbers", and returns false.
     */
    function need(n) {

        // If the stack already holds enough values, report success.
        if (state.stack.length >= n) return true;

        // Set the message, saying the stack is empty when only one value was needed.
        fail(n === 1 ? 'Stack is empty' : 'Needs ' + n + ' numbers');

        // Report that the stack is too short.
        return false;
    }

    /**
     * ### Description:
     * This function checks a calculated result and prepares it to be stored on the stack. It rejects error messages,
     * results that are not finite, and results that are too large for HEX or BIN mode.
     *
     * ### Parameters:
     * - `r`: A number or string representing the raw result of an operation. A string is treated as an error message.
     *
     * ### Returns:
     * - A number representing the checked result, with negative zero changed to zero. In HEX and BIN modes, the result
     *   is also truncated to a whole number.
     * - If `r` is a string, the function shows it as the error message and returns null.
     * - If `r` is not finite, the function sets "Not a real number" or "Result too large", and returns null.
     * - If the truncated result exceeds the largest safe integer in HEX or BIN mode, the function sets
     *   "Too large for" followed by the mode, and returns null.
     */
    function finish(r) {

        // If the operation returned an error message, show it and return null.
        if (typeof r === 'string') return fail(r);

        // If the result is not finite, say whether it is not a number or too large, then return null.
        if (!isFinite(r)) return fail(isNaN(r) ? 'Not a real number' : 'Result too large');

        // If the calculator is in HEX or BIN mode...
        if (isInt()) {

            // Drop any fractional part, as these modes hold whole numbers only.
            r = Math.trunc(r);

            // If the result is beyond the largest safe integer, show an error and return null.
            if (Math.abs(r) > Number.MAX_SAFE_INTEGER) return fail('Too large for ' + state.mode);
        }

        // Return the result, changing negative zero to zero.
        return Object.is(r, -0) ? 0 : r;
    }

    /**
     * ### Description:
     * This lookup table maps each two-number operator key to the function that calculates it. Each function receives
     * the second-from-top stack value (`y`) and the top stack value (`x`), in that order, and returns either a number
     * or an error message string.
     *
     * ### Returns:
     * - Each function returns a number representing the result of the operation.
     * - If the divisor is zero, the division function returns the string "Can't divide by zero".
     */
    const ops = {

        // Add the two values.
        '+': (y, x) => y + x,

        // Subtract the top value from the second value.
        '-': (y, x) => y - x,

        // Multiply the two values.
        '*': (y, x) => y * x,

        // Divide the second value by the top value, unless the top value is zero.
        '/': (y, x) => x === 0 ? "Can't divide by zero" : y / x,

        // Raise the second value to the power of the top value.
        '^': (y, x) => Math.pow(y, x)
    };

    /**
     * ### Description:
     * This function applies a two-number operation to the top two values on the stack and replaces them with the
     * result.
     *
     * ### Parameters:
     * - `fn`: A function representing the operation, which takes the second-from-top value and then the top value.
     *
     * ### Returns:
     * - Nothing. The function updates the stack directly.
     * - If the stack holds fewer than two values, or the result is rejected, the stack is left unchanged.
     */
    function binary(fn) {

        // Commit any number being typed so it counts as the top value.
        commitEntry();

        // If the stack holds fewer than two values, stop, as the operation needs two.
        if (!need(2)) return;

        // Get a reference to the stack.
        const s = state.stack;

        // Calculate the result from the top two values and check it.
        const r = finish(fn(s[s.length - 2], s[s.length - 1]));

        // If the result was rejected, leave the stack unchanged.
        if (r === null) return;

        // Replace the top two values with the result.
        s.splice(-2, 2, r);
    }

    /**
     * ### Description:
     * This function replaces the top stack value with its sine, cosine, or tangent, or with the inverse of one of
     * those, using the current angle unit.
     *
     * ### Parameters:
     * - `name`: A string representing the function to apply: "sin", "cos", or "tan".
     * - `inv`: A boolean representing whether to apply the inverse function (asin, acos, or atan) instead.
     *
     * ### Returns:
     * - Nothing. The function updates the top of the stack directly.
     * - If the stack is empty, the function leaves the stack unchanged.
     * - If the angle is a multiple of 90 degrees where tangent is undefined, the function sets "tan is undefined at"
     *   the angle, and leaves the stack unchanged.
     * - If an inverse sine or cosine is given a value outside -1 to 1, the function sets an error message and leaves
     *   the stack unchanged.
     * - If the result is rejected, the function leaves the stack unchanged.
     *
     * ### Notes:
     * - In degree mode, the exact results at multiples of 90 degrees are returned directly, so the display shows
     *   0 instead of tiny floating-point leftovers.
     * - In radian mode, results smaller than 1e-15 in size are treated as 0 for the same reason.
     */
    function trig(name, inv) {

        // Commit any number being typed so it counts as the top value.
        commitEntry();

        // If the stack is empty, stop, as there is no value to work on.
        if (!need(1)) return;

        // Get a reference to the stack.
        const s = state.stack;

        // Get the top value, which is the angle or ratio to work on.
        const x = s[s.length - 1];

        // Check whether the angle unit is degrees.
        const deg = state.angle === 'DEG';

        // Declare the result, which is filled in below.
        let r;

        // If this is a normal (not inverse) function...
        if (!inv) {

            // If the angle unit is degrees...
            if (deg) {

                // Exact answers at multiples of 90° instead of floating-point dust.
                // Reduce the angle to the range 0 up to 360, which also handles negative angles.
                const m = ((x % 360) + 360) % 360;

                // If sine or tangent is taken at 0° or 180°, the exact result is 0.
                if ((name === 'sin' || name === 'tan') && m % 180 === 0) r = 0;

                // If cosine is taken at 90° or 270°, the exact result is 0.
                else if (name === 'cos' && (m === 90 || m === 270)) r = 0;

                // If tangent is taken at 90° or 270°, it is undefined, so report that and stop.
                else if (name === 'tan' && (m === 90 || m === 270)) return fail('tan is undefined at ' + fmtDec(x) + '°');
            }

            // If no exact answer was found above...
            if (r === undefined) {

                // Calculate the result, converting degrees to radians first when needed.
                r = Math[name](deg ? x * Math.PI / 180 : x);

                // Treat results that are extremely close to zero as exactly zero.
                if (Math.abs(r) < 1e-15) r = 0;
            }
        }
        else {

            // Inverse sine and cosine only accept values from -1 to 1, so report an error and stop for anything else.
            if (name !== 'tan' && Math.abs(x) > 1) return fail(name + '⁻¹ needs a value from −1 to 1');

            // Calculate the inverse function, which gives an angle in radians.
            r = Math['a' + name](x);

            // If the angle unit is degrees, convert the result from radians to degrees.
            if (deg) r = r * 180 / Math.PI;
        }

        // Check the result.
        r = finish(r);

        // If the result is valid, replace the top value with it.
        if (r !== null) s[s.length - 1] = r;
    }

    /**
     * ### Description:
     * This function checks whether a key character is a valid digit in the current number mode.
     *
     * ### Parameters:
     * - `d`: A string representing a single key character, such as "7", "A", or ".".
     *
     * ### Returns:
     * - A boolean that is true when the character is allowed in the current mode.
     * - DEC mode allows 0 to 9 and the decimal point, HEX mode allows 0 to 9 and A to F, and BIN mode allows 0 and 1.
     */
    function validDigit(d) {

        // In DEC mode, allow the digits 0 to 9 and the decimal point.
        if (state.mode === 'DEC') return /^[0-9.]$/.test(d);

        // In HEX mode, allow the digits 0 to 9 and the letters A to F.
        if (state.mode === 'HEX') return /^[0-9A-F]$/.test(d);

        // Implied else, the mode is BIN, so allow only 0 and 1.
        return /^[01]$/.test(d);
    }

    /**
     * ### Description:
     * This function adds a digit or decimal point to the number being typed.
     *
     * ### Parameters:
     * - `d`: A string representing a single key character, such as "7", "A", or ".".
     *
     * ### Returns:
     * - Nothing when the character is accepted. The function updates the entry line directly.
     * - If the character is not valid in the current mode, the function sets an error message and returns null.
     * - If the entry already holds the maximum number of digits for the current mode, the function sets
     *   "Entry limit reached" and returns null.
     */
    function digit(d) {

        // If the character is not valid in this mode, say why and stop.
        if (!validDigit(d)) {
            return fail(d === '.' ? 'No decimals in ' + state.mode : d + " isn't a " + state.mode + ' digit');
        }

        // If no number is being typed, start a new entry (a lone decimal point starts as "0.") and stop.
        if (state.entry === null) {
            state.entry = d === '.' ? '0.' : d;
            return;
        }

        // If the entry already holds the maximum number of digits, say so and stop. The sign and point are not counted.
        if (state.entry.replace(/[-.]/g, '').length >= LIMIT[state.mode]) return fail('Entry limit reached');

        // If the character is a decimal point, add it only when the entry does not already have one, then stop.
        if (d === '.') {
            if (!state.entry.includes('.')) state.entry += '.';
            return;
        }

        // If the entry is just "0", replace it with the digit so there is no leading zero.
        if (state.entry === '0') state.entry = d;

        // If the entry is just "-0", replace the zero with the digit and keep the minus sign.
        else if (state.entry === '-0') state.entry = '-' + d;

        // Implied else, add the digit to the end of the entry.
        else state.entry += d;
    }

    /**
     * ### Description:
     * This function switches the calculator to a different number mode and saves the choice. When switching to HEX or
     * BIN, any fractions on the stack are dropped.
     *
     * ### Parameters:
     * - `m`: A string representing the mode to switch to: "DEC", "HEX", or "BIN".
     *
     * ### Returns:
     * - Nothing. The function updates the calculator state directly.
     * - If `m` is already the current mode, the function does nothing.
     * - If any fractions were dropped from the stack, the function sets the message "Fractions dropped".
     */
    function setMode(m) {

        // If the calculator is already in this mode, there is nothing to do.
        if (m === state.mode) return;

        // Commit any number being typed so it is read in the old mode.
        commitEntry();

        // Switch to the new mode.
        state.mode = m;

        // If the new mode holds whole numbers only...
        if (isInt()) {

            // Track whether any fractional part gets dropped.
            let dropped = false;

            // Truncate every value on the stack, noting any value that changed.
            state.stack = state.stack.map(v => {
                const t = Math.trunc(v);
                if (t !== v) dropped = true;
                return t;
            });

            // If any fractions were dropped, tell the user.
            if (dropped) state.msg = 'Fractions dropped';
        }

        // Save the new mode so it is remembered next time.
        save();
    }

    /**
     * ### Description:
     * This function handles one key press, from the on-screen keypad or the keyboard, and then redraws the display.
     * It covers digits, operators, memory store and recall, trig and pi, mode and angle changes, and stack editing.
     *
     * ### Parameters:
     * - `k`: A string representing the key's name, such as "7", "+", "enter", "sto", "mem2", "sin", "mode:HEX", or
     *   "angle:RAD".
     *
     * ### Returns:
     * - Nothing. The function updates the calculator state and redraws the display.
     * - Any message from the previous key press is cleared first. A key that fails sets a new message instead.
     *
     * ### Notes:
     * - Pressing the store key arms the memory keys, so the next memory key stores the top value instead of recalling.
     *   Any other key disarms it.
     * - The inverse key applies to the next key press only. Trig and pi keys are not available in HEX or BIN mode.
     */
    function press(k) {

        // Clear the message left by the previous key press.
        state.msg = '';

        // Get a reference to the stack.
        const s = state.stack;

        // Store and recall memory. -----------------------------------------------

        // If the key is the store key...
        if (k === 'sto') {

            // If the store key was already armed, pressing it again cancels the store.
            if (state.armed) {
                state.armed = false;
            }
            else {

                // Commit any number being typed so it can be stored.
                commitEntry();

                // If there is a value to store, arm the memory keys and prompt the user.
                if (need(1)) {
                    state.armed = true;
                    state.msg = 'Pick a memory key for X';
                }
            }

            // Redraw the display and stop.
            return render();
        }

        // Check whether the key is one of the four memory keys.
        const mm = /^mem([0-3])$/.exec(k);

        // If the key is a memory key...
        if (mm) {

            // Get the memory slot number, from 0 to 3.
            const i = +mm[1];

            // If the store key was armed, store the top value in this slot.
            if (state.armed) {
                state.mem[i] = s[s.length - 1];
                state.armed = false;
                state.msg = 'Stored in M' + (i + 1);
                save();
            }

            // If the slot is empty, there is nothing to recall, so show an error.
            else if (state.mem[i] === null) {
                fail('M' + (i + 1) + ' is empty');
            }

            // Implied else, recall the slot's value onto the stack.
            else {

                // Commit any number being typed so it stays below the recalled value.
                commitEntry();

                // Get the saved value.
                const v = state.mem[i];

                // Push the value onto the stack, dropping any fraction in HEX and BIN modes.
                s.push(isInt() ? Math.trunc(v) : v);
            }

            // Redraw the display and stop.
            return render();
        }

        // Any other key disarms the store key.
        state.armed = false;

        // Trig, inverse, and pi keys. --------------------------------------------

        // Remember whether the inverse key was active, then switch it off, as it only applies to one key press.
        const inv = state.inv;
        state.inv = false;

        // If the key is the inverse, a trig function, or pi...
        if (k === 'inv' || k === 'sin' || k === 'cos' || k === 'tan' || k === 'pi') {

            // If the calculator is in HEX or BIN mode, these keys are not available, so show an error.
            if (isInt()) fail('Trig and π work in DEC mode');

            // If the key is the inverse key, switch the inverse setting to the opposite of what it was.
            else if (k === 'inv') state.inv = !inv;

            // If the key is pi, push the value of pi onto the stack.
            else if (k === 'pi') {
                commitEntry();
                s.push(Math.PI);
            }

            // Implied else, apply the trig function, using the inverse form when it was active.
            else trig(k, inv);

            // Redraw the display and stop.
            return render();
        }

        // If the key is an angle unit key, switch to that unit, save it, then redraw the display and stop.
        if (k.startsWith('angle:')) {
            state.angle = k.slice(6);
            save();
            return render();
        }

        // Digits, operators, modes, and stack editing. ---------------------------

        // If the key is a digit or a decimal point, add it to the number being typed.
        if (/^[0-9A-F.]$/.test(k)) {
            digit(k);
        }

        // If the key is a two-number operator, apply it to the top two stack values.
        else if (k in ops) {
            binary(ops[k]);
        }

        // If the key is a mode key, switch to that number mode.
        else if (k.startsWith('mode:')) {
            setMode(k.slice(5));
        }

        // Implied else, handle the remaining single-purpose keys.
        else switch (k) {

            // Enter either commits the number being typed or duplicates the top value.
            case 'enter':

                // If a number is being typed, commit it to the stack.
                if (state.entry !== null) commitEntry();

                // Implied else, if the stack has a top value, push a copy of it.
                else if (need(1)) s.push(s[s.length - 1]);
                break;

            // Square root replaces the top value with its square root.
            case 'sqrt': {

                // Commit any number being typed so it counts as the top value.
                commitEntry();

                // If the stack is empty, stop.
                if (!need(1)) break;

                // If the top value is negative, there is no real square root, so show an error and stop.
                if (s[s.length - 1] < 0) {
                    fail("Can't root a negative");
                    break;
                }

                // Calculate and check the square root.
                const r = finish(Math.sqrt(s[s.length - 1]));

                // If the result is valid, replace the top value with it.
                if (r !== null) s[s.length - 1] = r;
                break;
            }

            // Negate flips the sign of the number being typed, or of the top stack value.
            case 'neg':

                // If a number is being typed, add or remove its leading minus sign.
                if (state.entry !== null) {
                    state.entry = state.entry.startsWith('-') ? state.entry.slice(1) : '-' + state.entry;
                }

                // Implied else, if the stack has a top value, flip its sign, changing negative zero to zero.
                else if (need(1)) {
                    s[s.length - 1] = -s[s.length - 1] || 0;
                }
                break;

            // Swap exchanges the top two stack values.
            case 'swap':

                // Commit any number being typed so it counts as the top value.
                commitEntry();

                // If the stack holds at least two values, swap the top two.
                if (need(2)) {
                    const n = s.length;
                    [s[n - 1], s[n - 2]] = [s[n - 2], s[n - 1]];
                }
                break;

            // Pop discards the number being typed, or the top stack value.
            case 'pop':

                // If a number is being typed, discard it.
                if (state.entry !== null) state.entry = null;

                // Implied else, if the stack has a top value, remove it.
                else if (need(1)) s.pop();
                break;

            // Flush clears the whole stack and the entry line.
            case 'flush':
                state.stack = [];
                state.entry = null;
                break;

            // Memory clear empties all four memory slots and saves the change.
            case 'mc':
                state.mem = [null, null, null, null];
                state.msg = 'Memory cleared';
                save();
                break;

            // Backspace removes the last typed character.
            case 'back':

                // A committed X is pulled back into the entry line so it can be edited.
                if (state.entry === null && s.length) state.entry = editString(s.pop());

                // If there is an entry to edit...
                if (state.entry !== null) {

                    // Remove the last character.
                    state.entry = state.entry.slice(0, -1);

                    // If nothing useful is left (empty or just a minus sign), clear the entry line.
                    if (state.entry === '' || state.entry === '-') state.entry = null;
                }
                break;
        }

        // Redraw the display with the new state.
        render();
    }

    /**
     * ### Description:
     * This function writes text into one of the display rows, picks a size class based on how long the text is, and
     * adds a blinking cursor when the row shows the number being typed.
     *
     * ### Parameters:
     * - `node`: An element representing the display row to update.
     * - `text`: A string representing the text to show. If it is empty or undefined, the row is cleared.
     * - `isEntry`: A boolean representing whether the text is the number currently being typed.
     *
     * ### Returns:
     * - Nothing. The function updates the element directly.
     *
     * ### Notes:
     * - The main X row is larger than the other rows, so its text length cutoffs for the "long" and "xlong" size
     *   classes are shorter.
     */
    function setVal(node, text, isEntry) {

        // Use an empty string when there is no text to show.
        const t = text || '';

        // Check whether this is the main X row, which has a larger font.
        const big = node === el.X;

        // Use the "long" size class when the text is long, and the "xlong" class when it is longer still.
        node.classList.toggle('long', t.length > (big ? 13 : 17) && t.length <= (big ? 21 : 26));
        node.classList.toggle('xlong', t.length > (big ? 21 : 26));

        // Write the text into the row.
        node.textContent = t;

        // Mark the row as being edited when it shows the number being typed.
        node.classList.toggle('editing', !!isEntry);

        // If the row shows the number being typed, add a cursor after the text.
        if (isEntry) {
            const c = document.createElement('span');
            c.className = 'cursor';
            c.setAttribute('aria-hidden', 'true');
            node.appendChild(c);
        }

        // Scroll the row to the far right so the newest digits stay visible.
        node.scrollLeft = node.scrollWidth;
    }

    /**
     * ### Description:
     * This function redraws the whole calculator display from the current state. It updates the four stack rows, the
     * message, the depth and mode labels, and the state of every button (pressed, enabled, and memory contents).
     *
     * ### Returns:
     * - Nothing. The function updates the page directly.
     */
    function render() {

        // Stack rows. ------------------------------------------------------------

        // Format every value on the stack as display text.
        const items = state.stack.map(fmt);

        // Check whether a number is being typed.
        const entering = state.entry !== null;

        // If a number is being typed, add it as the last row, grouping binary digits in fours.
        if (entering) items.push(state.mode === 'BIN' ? group4(state.entry) : state.entry);

        // Get the total number of rows to show.
        const n = items.length;

        // Show the top four rows, with X as the last one. The entry row shows a cursor.
        setVal(el.X, items[n - 1], entering);
        setVal(el.Y, items[n - 2]);
        setVal(el.Z, items[n - 3]);
        setVal(el.T, items[n - 4]);

        // Message and labels. ----------------------------------------------------

        // Clear the old message.
        el.msg.textContent = '';

        // If there is a new message, show it with the error style.
        if (state.msg) {
            const e = document.createElement('span');
            e.className = 'err';
            e.textContent = state.msg;
            el.msg.appendChild(e);
        }

        // Show how many values sit below the four visible rows, or the stack depth when it fits.
        el.depth.textContent = n > 4 ? '+' + (n - 4) + ' below' : (n ? 'depth ' + n : '');

        // Show the current mode, plus the angle unit in DEC mode.
        el.modeTag.textContent = state.mode + (isInt() ? '' : ' ' + state.angle);

        // Button states. ---------------------------------------------------------

        // For each mode and angle button, show whether it is selected.
        document.querySelectorAll('.mode').forEach(b => {

            // Split the button's key into its kind ("mode" or "angle") and its value.
            const [kind, val] = b.dataset.k.split(':');

            // Mark the button as pressed when its value matches the current mode or angle unit.
            b.setAttribute('aria-pressed', String(kind === 'mode' ? val === state.mode : val === state.angle));

            // Angle buttons do nothing in HEX and BIN modes, so disable them there.
            if (kind === 'angle') b.disabled = isInt();
        });

        // Disable the scientific buttons in HEX and BIN modes.
        sciBtns.forEach(b => { b.disabled = isInt(); });

        // For each trig button, show the inverse label when the inverse key is active, and update its tooltip.
        document.querySelectorAll('.trig').forEach(b => {
            const name = b.dataset.k;
            b.textContent = state.inv ? name + '⁻¹' : name;
            b.title = (state.inv ? 'Inverse ' : '') + name + ' of X, in ' + (state.angle === 'DEG' ? 'degrees' : 'radians');
        });

        // Highlight the inverse button while the inverse setting is active.
        const invBtn = document.querySelector('[data-k="inv"]');
        invBtn.classList.toggle('on', state.inv);
        invBtn.setAttribute('aria-pressed', String(state.inv));

        // Disable the digit buttons that are not valid in the current mode.
        digitBtns.forEach(b => { b.disabled = !validDigit(b.dataset.k); });

        // Memory buttons. --------------------------------------------------------

        // For each memory button, show its stored value and update its label and tooltip.
        memBtns.forEach((b, i) => {

            // Get the stored value, which is null when the slot is empty.
            const v = state.mem[i];

            // Check whether the slot holds a value.
            const filled = v !== null;

            // Style the button differently when its slot holds a value.
            b.classList.toggle('filled', filled);

            // Get the text to show, which is the formatted value or the word "empty".
            const shown = filled ? fmt(v) : 'empty';

            // Show the text on the button.
            b.querySelector('.mval').textContent = shown;

            // Set the tooltip and the screen reader label.
            b.title = filled ? 'M' + (i + 1) + ' holds ' + shown + ' — tap to recall' : 'M' + (i + 1) + ' is empty';
            b.setAttribute('aria-label', 'Memory ' + (i + 1) + (filled ? ', holds ' + shown : ', empty'));
        });

        // Show the keypad as armed while the store key is waiting for a memory key.
        el.keys.classList.toggle('armed', state.armed);

        // Highlight the store button while it is armed.
        const sto = document.querySelector('[data-k="sto"]');
        sto.classList.toggle('on', state.armed);
        sto.setAttribute('aria-pressed', String(state.armed));
    }

    /**
     * ### Description:
     * This function handles clicks anywhere on the calculator. If the click landed on, or inside, an enabled key, it
     * passes that key's name to the key press handler.
     *
     * ### Parameters:
     * - `e`: An event representing the click, whose target is the clicked element.
     *
     * ### Returns:
     * - Nothing. If the click was not on an enabled key, the function does nothing.
     */
    document.querySelector('.device').addEventListener('click', (e) => {

        // Find the key button the click landed on, or inside of.
        const b = e.target.closest('[data-k]');

        // If the click was on an enabled key, handle that key press.
        if (b && !b.disabled) press(b.dataset.k);
    });

    // Map keyboard keys that are not digits or letters to the calculator key names they trigger.
    const keymap = {
        'Enter': 'enter',
        '=': 'enter',
        'Backspace': 'back',
        'Delete': 'pop',
        'Escape': 'flush',
        's': 'swap',
        'S': 'swap',
        'r': 'sqrt',
        'R': 'sqrt',
        'n': 'neg',
        'N': 'neg',
        '_': 'neg',
        '+': '+',
        '-': '-',
        '*': '*',
        'x': '*',
        '/': '/',
        '^': '^',
        ',': '.'
    };

    /**
     * ### Description:
     * This function handles keyboard presses by translating them into calculator key names, passing them to the key
     * press handler, and briefly flashing the matching on-screen button.
     *
     * ### Parameters:
     * - `e`: An event representing the key press, with the key's name and any modifier keys held.
     *
     * ### Returns:
     * - Nothing. Presses that the calculator does not use are ignored and left to the browser.
     *
     * ### Notes:
     * - Key presses with Ctrl, Cmd, or Alt held are ignored, so browser shortcuts keep working.
     * - Key presses inside the install area are ignored.
     * - The letters A to F type HEX digits, "p" is pi, "i" is the inverse key, and "m" cycles through the number modes.
     * - Pressing Escape while the store key is armed only cancels the store, instead of clearing the stack.
     */
    document.addEventListener('keydown', (e) => {

        // Ignore shortcuts that use a modifier key, so browser shortcuts keep working.
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // Ignore key presses inside the install area.
        if (e.target.closest && e.target.closest('.install')) return;

        // Start with no calculator key.
        let k = null;

        // If the key is a digit or decimal point, use it as-is.
        if (/^[0-9.]$/.test(e.key)) k = e.key;

        // If the key is a letter from A to F, use it as a capital HEX digit.
        else if (/^[a-fA-F]$/.test(e.key)) k = e.key.toUpperCase();

        // If the key is "p", use the pi key.
        else if (e.key === 'p' || e.key === 'P') k = 'pi';

        // If the key is "i", use the inverse key.
        else if (e.key === 'i' || e.key === 'I') k = 'inv';

        // If the key is "m", switch to the next number mode in the cycle.
        else if (e.key === 'm' || e.key === 'M') k = 'mode:' + MODES[(MODES.indexOf(state.mode) + 1) % 3];

        // Otherwise look the key up in the key map.
        else if (keymap[e.key]) k = keymap[e.key];

        // If the key is not one the calculator uses, leave it to the browser.
        if (!k) return;

        // Stop the browser from also acting on this key.
        e.preventDefault();

        // If Escape was pressed while the store key is armed, cancel the store only, then redraw and stop.
        if (k === 'flush' && state.armed) {
            state.armed = false;
            state.msg = '';
            return render();
        }

        // Handle the key press.
        press(k);

        // Find the on-screen button that matches the key.
        const b = document.querySelector('[data-k="' + CSS.escape(k) + '"]');

        // If the button exists and is enabled, flash it briefly so the press is visible.
        if (b && !b.disabled) {
            b.classList.add('pressed');
            setTimeout(() => b.classList.remove('pressed'), 110);
        }
    });

    // Find the elements that hold and display the calculator, which are scaled to fit the window.
    const stage = document.getElementById('stage');
    const device = document.getElementById('device');

    /**
     * ### Description:
     * This function scales the calculator so that it fits inside the window without changing its proportions, and sizes
     * the surrounding stage to match the scaled calculator.
     *
     * ### Returns:
     * - Nothing. The function updates the styles of the calculator and the stage directly.
     */
    function fit() {

        // Get the page's computed style, which holds its top and bottom padding.
        const cs = getComputedStyle(document.documentElement);

        // Get the available width.
        const availW = document.documentElement.clientWidth;

        // Get the available height, which is the window height minus the page's top and bottom padding.
        const availH = window.innerHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

        // Get the calculator's natural width and height.
        const w = device.offsetWidth, h = device.offsetHeight;

        // Pick the scale that fits both the width and the height.
        const k = Math.min(availW / w, availH / h);

        // Scale the calculator.
        device.style.transform = 'scale(' + k + ')';

        // Size the stage to match the scaled calculator.
        stage.style.width = Math.floor(w * k) + 'px';
        stage.style.height = Math.floor(h * k) + 'px';
    }

    // Refit the calculator whenever the window is resized.
    window.addEventListener('resize', fit);

    // Refit the calculator whenever the calculator itself changes size, if the browser supports watching for that.
    if (window.ResizeObserver) new ResizeObserver(fit).observe(device);

    // Refit once the fonts have loaded, as they can change the calculator's size.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

    // PWA: offline support and install button. -------------------------------

    // If the browser supports service workers and the page is served over http or https...
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {

        // Wait until the page has loaded, then register the offline service worker, ignoring any failure.
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        });
    }

    // Find the install button and the iOS install instructions.
    const installBtn = document.getElementById('installBtn');
    const iosHint = document.getElementById('iosHint');

    // Watch for the page running as an installed app.
    const standaloneMQ = window.matchMedia('(display-mode: standalone)');

    /**
     * ### Description:
     * This function reports whether the page is running as an installed app instead of in a browser tab.
     *
     * ### Returns:
     * - A boolean that is true when the page is running in standalone mode, including the older iOS check.
     */
    const isStandalone = () => standaloneMQ.matches || navigator.standalone === true;

    // Check whether the device is an iPhone, iPad, or iPod, including iPads that report themselves as a Mac.
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Hold the browser's install prompt until the user asks to install.
    let deferredPrompt = null;

    /**
     * ### Description:
     * This function hides both the install button and the iOS install instructions.
     *
     * ### Returns:
     * - Nothing. The function updates the page directly.
     */
    function hideInstall() {

        // Hide the install button and the iOS install instructions.
        installBtn.hidden = true;
        iosHint.hidden = true;
    }

    /**
     * ### Description:
     * This function runs when Chrome, Edge, or Samsung Internet reports that the app can be installed. It holds the
     * install prompt for later and shows the install button, unless the app is already installed.
     *
     * ### Parameters:
     * - `e`: An event representing the browser's install prompt offer.
     *
     * ### Returns:
     * - Nothing. The function updates the page directly.
     */
    window.addEventListener('beforeinstallprompt', (e) => {

        // Chrome, Edge, Samsung Internet: the browser tells us when the app can be installed.
        // Stop the browser from showing its own prompt right away.
        e.preventDefault();

        // Hold the prompt until the user clicks the install button.
        deferredPrompt = e;

        // If the app is not already installed, show the install button.
        if (!isStandalone()) installBtn.hidden = false;
    });

    /**
     * ### Description:
     * This function runs when the install button is clicked. If the browser offered an install prompt, it shows it. On
     * iOS, which has no install prompt, it shows or hides the instructions instead.
     *
     * ### Returns:
     * - Nothing. The function updates the page directly.
     */
    installBtn.addEventListener('click', async () => {

        // If the browser gave us an install prompt...
        if (deferredPrompt) {

            // Show the install prompt.
            deferredPrompt.prompt();

            // Wait for the user to accept or decline.
            const choice = await deferredPrompt.userChoice;

            // Discard the prompt, as it can only be used once.
            deferredPrompt = null;

            // The prompt can only be used once; the browser offers a fresh one later if declined.
            // Hide the install button for now.
            installBtn.hidden = true;

            // If the user accepted, hide the iOS instructions too.
            if (choice.outcome === 'accepted') hideInstall();
        }

        // Implied else, if the device is an iOS device, show or hide the install instructions.
        else if (isIOS) {
            iosHint.hidden = !iosHint.hidden;
        }
    });

    // When the app finishes installing, discard the prompt and hide the install controls.
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        hideInstall();
    });

    // When the page switches to running as an installed app, hide the install controls, if the browser supports watching for that.
    standaloneMQ.addEventListener && standaloneMQ.addEventListener('change', () => {
        if (isStandalone()) hideInstall();
    });

    // Safari on iOS has no install prompt, so the button shows instructions instead.
    // If the device is an iOS device and the app is not installed, show the install button.
    if (isIOS && !isStandalone()) installBtn.hidden = false;

    // If the app is already installed, hide the install controls.
    if (isStandalone()) hideInstall();

    // Start up. --------------------------------------------------------------

    // Load the saved memory slots and settings.
    load();

    // Draw the first screen.
    render();

    // Scale the calculator to fit the window.
    fit();
})();