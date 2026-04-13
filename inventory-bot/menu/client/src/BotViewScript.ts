let contextParams: google.script.ContextParams | undefined = undefined;

// Fetch template variables from Server
init();

function init() {
    // @ts-ignore
    google.script.url.getLocation(loadTemplate);
}

function loadTemplate(location: google.script.IUrlLocation) {
    const parameters = location.parameter;
    disableButtons(true);
    google.script.run.withSuccessHandler((params: google.script.ContextParams) => setParams(params)).getContextParams(parameters);
}

function setParams(params: google.script.ContextParams) {
    contextParams = params;
    google.script.run.withSuccessHandler(showAccountsList).getAccountsToCalculate(contextParams);
}

function showAccountsList(accountsToCalculate: { accountName: string, accountId: string }[]) {
    const ul = $('#account-list');
    for (const account of accountsToCalculate) {
        ul.append($('<li></li>').html(`<p>${account.accountName}</p>`));
    }
    ul.show();

    disableButtons(false);
}

function calculate() {
    disableButtons(true);
    if (contextParams) {
        google.script.run.withSuccessHandler(() => {
            try {
                fireCalculateForAll();
            } catch (error) {
                showError(error);
            }
        })
            .withFailureHandler((error) => {
                showError(error);
            })
            .validate(contextParams.book.id)
            ;
    }
}

function fireCalculateForAll() {
    google.script.run.withSuccessHandler(showResults).withFailureHandler(showError).calculateCostOfSales(contextParams);
}

function reset() {
    disableButtons(true);
    if (contextParams) {
        google.script.run.withSuccessHandler(() => {
            try {
                fireResetForAll();
            } catch (error) {
                showError(error);
            }
        })
            .withFailureHandler((error) => {
                showError(error);
            })
            .validate(contextParams.book.id)
            ;
    }
}

function fireResetForAll() {
    google.script.run.withSuccessHandler(showResults).withFailureHandler(showError).resetCostOfSales(contextParams);
}

function showResults(results: { accountName: string, result: string }[]) {
    const ul = $('#account-list').empty();
    for (const account of results) {
        ul.append($('<li></li>').html(`<p>${account.accountName}: &nbsp;${account.result}</p>`));
    }
    ul.show();

    disableButtons(false);
}

function showError(error: any) {
    window.alert(error);
}

function disableButtons(disable: boolean) {
    if (disable) {
        $('#calculate-button').prop('disabled', true);
        $('#close-button').prop('disabled', true);
        $('#reset-button').prop('disabled', true);
    } else {
        $('#calculate-button').prop('disabled', false);
        $('#close-button').prop('disabled', false);
        $('#reset-button').prop('disabled', false);
    }
}

function closeWindow() {
    try {
        window.top.close();
    } catch (error) {
        console.log("Attempt to automatically close window failed: " + error);
        showError(error);
    }
}