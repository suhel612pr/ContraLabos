/* ============================================================
   CONTRALABOS — FORM VALIDATION
   Wires native HTML5 constraint validation to the .field.invalid
   / .field .error visual states already defined in app.css.
   Include after any page with <form> elements.
   ============================================================ */
function wireFormValidation(form){
  if(!form) return;
  form.setAttribute("novalidate", "true");

  function fieldWrap(input){
    return input.closest(".field");
  }
  function showError(input){
    const wrap = fieldWrap(input);
    if(!wrap) return;
    wrap.classList.add("invalid");
    let err = wrap.querySelector(".error");
    if(!err){
      err = document.createElement("div");
      err.className = "error";
      wrap.appendChild(err);
    }
    err.textContent = input.validationMessage || "This field is required.";
  }
  function clearError(input){
    const wrap = fieldWrap(input);
    if(wrap) wrap.classList.remove("invalid");
  }

  form.querySelectorAll("input, select, textarea").forEach(input => {
    input.addEventListener("blur", () => {
      if(input.checkValidity()) clearError(input); else showError(input);
    });
    input.addEventListener("input", () => {
      if(input.checkValidity()) clearError(input);
    });
  });

  // Runs on the DOCUMENT in the capture phase, which fires before the form's
  // own bubble-phase submit listener even though this code loads later —
  // capture-phase listeners on ancestors always run before at-target listeners.
  document.addEventListener("submit", function(e){
    if(e.target !== form) return;
    let firstInvalid = null;
    form.querySelectorAll("input, select, textarea").forEach(input => {
      if(!input.checkValidity()){
        showError(input);
        if(!firstInvalid) firstInvalid = input;
      } else {
        clearError(input);
      }
    });
    if(firstInvalid){
      e.preventDefault();
      e.stopImmediatePropagation();
      firstInvalid.focus();
    }
  }, true);
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form").forEach(wireFormValidation);
});
