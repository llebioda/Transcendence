export function LoginView(): HTMLElement {
  const container: HTMLDivElement = document.createElement("div");
  container.className = "flex justify-center items-center min-h-screen";
  container.innerHTML = `
	<div class="bg-gray-800 p-8 rounded-lg shadow-xl max-w-sm w-full">
      <h2 class="text-3xl text-center font-bold text-indigo-400 mb-6">
        Se connecter
      </h2>

      <form id="loginForm" action="#" method="POST">
        <div class="mb-4">
          <label for="email" class="block text-sm font-medium text-purple-300"
            >Email</label
          >
          <input
            type="email"
            id="email"
            name="email"
            class="w-full px-4 py-2 bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Votre email"
            required
          />
        </div>

        <div class="mb-4">
          <label
            for="password"
            class="block text-sm font-medium text-purple-300"
            >Mot de passe</label
          >
          <input
            type="password"
            id="password"
            name="password"
            class="w-full px-4 py-2 bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Votre mot de passe"
            required
          />
        </div>

        <button
          type="submit"
          class="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          Se connecter
        </button>
      </form>

<div class="mt-6">
  <div id="google-auth" class="google-btn">
    <div class="google-icon-wrapper">
      <img class="google-icon" src="https://developers.google.com/identity/images/g-logo.png" alt="Google logo">
    </div>
    <p class="btn-text"><b>Se connecter avec Google</b></p>
  </div>
</div>

      <div class="mt-4 text-center">
        <p class="text-sm text-purple-300">
          Pas encore de compte ?
          <a href="/auth/signup" data-link class="text-indigo-400 hover:underline"
            >S'inscrire</a
          >
        </p>
      </div>
	</div>
`;
  return container;
}
