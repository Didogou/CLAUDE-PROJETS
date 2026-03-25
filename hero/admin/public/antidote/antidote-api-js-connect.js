/* antidote-api-js-connect.js */


function laFonctionDeRappel(){
	console.log("test fonction de rappel");
}

document.addEventListener('DOMContentLoaded', function () {
	document.getElementById('initAntidote').addEventListener('click', 
					function onclick(ev){
							window.activeAntidoteAPI_JSConnect(laFonctionDeRappel);
							window.alert('Antidote : Boutons JS-Connect activés');
					}
				);
	document.getElementById('desinitAntidote').addEventListener('click', 
					function onclick(ev){
							window.desactiveAntidoteAPI_JSConnect();
							window.alert('Antidote : Boutons JS-Connect désactivés');
					}
				);

	
});
