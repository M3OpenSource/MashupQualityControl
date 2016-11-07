import System;
import System.Collections.Specialized;
import System.IO;
import System.Text;
import System.Text.RegularExpressions;
import System.Web;
import System.Xml;
import Mango.Core.Util;
import Mango.UI.Core.Util;
import Mango.UI.Services.Mashup;
import Mango.UI.Services.Mashup.Internal;
import MForms;

/*
Quality Control for Infor Smart Office Mashups
Thibaud Lopez Schneider
2016-11-07
https://github.com/M3OpenSource/MashupQualityControl
https://m3ideas.org/?s=mashup+quality+control


PENDING:
- See the pending stuff on the blog posts and the comments
- See the pending stuff throughout this code
- Verify date format consistency: Source=x:Static sys:DateTime.Today, StringFormat='\0:yyyy'...,  <controls:DatePicker DateFormat="yyyy-MM-dd"...
- Verify using current in {mashup:UserContextValue Path=M3/Current(Company|Division|Facility)} instead of simply Company|Division|Facility or CONO|DIVI|FACI
- Verify Uri such as in <mashup:WebBrowser @Uri @StartUri>, or in <mashup:Link>, or @LinkUri
- Verify the REST web services
- Are we exceeding the debug console capacity?
- Implement refresh verification stuff https://m3ideas.org/2016/05/05/mashup-quality-control-2/
*/ 
   
package MForms.JScript {
	class MashupQualityControl {

		var debug: ScriptDebugConsole;
		var regex: Regex = StringUtil.GetRegex(ParameterBracket.Curly); // {(?<param>[\u0000-\uFFFF-[}]]*)}

		public function Init(element: Object, args: Object, controller : Object, debug : Object) {
			this.debug = debug;
			// for each Mashup
			var mashups /*IList<FileInfo>*/ = PackageHelper.GetSharedMashupList(); // PENDING: use GetPrivateMashupList() and GetLocalMashupList() to get the private and local Mashups
			for (var mashup: FileInfo in mashups) {
				var baseUri: Uri = UriHelper.CreateBaseUri(new Uri(mashup.Name, UriKind.RelativeOrAbsolute));
				var manifest: Manifest = PackageHelper.GetManifest(mashup);
				// for each XAML
				var list /*IList<FileInformation>*/ = manifest.CreateFileInformationList();
				for (var information: FileInformation in list) {
					if (information.MimeType == Defines.MimeTypeXAML) {
						// load the XAML
						var relativeUri: String = information.Path;
						var stream: Stream = PackageHelper.GetStream(baseUri, new Uri(relativeUri, UriKind.Relative));
						var document: XmlDocument = new XmlDocument();
						document.Load(stream);
						// do verifications
						verifyIsListHeaderVisible(mashup.Name, relativeUri, document);
						verifyMFormsBookmarks(mashup.Name, relativeUri, document);
						verifyMFormsAutomation(mashup.Name, relativeUri, document);
						verifyDocumentArchive(mashup.Name, relativeUri, document);
						verifyWebServices(mashup.Name, relativeUri, document);
						verifyValues(mashup.Name, relativeUri, document);
						// next
						stream.Close();
					}
				}
			}
		}

		// ensure the m3:ListPanel have IsListHeaderVisible=True; based on https://m3ideas.org/2016/05/04/mashup-quality-control/
		function verifyIsListHeaderVisible(mashupName: String, relativeUri: String, document: XmlDocument) {
			var nsmanager: XmlNamespaceManager = new XmlNamespaceManager(document.NameTable);
			nsmanager.AddNamespace("m3", "clr-namespace:MForms.Mashup;assembly=MForms");
			var nodes: XmlNodeList = document.SelectNodes("//m3:ListPanel[not(@IsListHeaderVisible=\"True\")]", nsmanager);
			for (var element: XmlElement in nodes) {
				debug.WriteLine([mashupName, relativeUri, GetPath(element), "IsListHeaderVisible!=True"]);
			}
		}

		// ensure the MForms Bookmarks don't have hard-coded values; based on https://m3ideas.org/2016/05/18/mashup-quality-control-5/
		function verifyMFormsBookmarks(mashupName: String, relativeUri: String, document: XmlDocument) {
			var nodes: XmlNodeList = document.SelectNodes("//@*[name()='Uri' or name()='LinkUri']");
			for (var attribute: XmlAttribute in nodes) {
				if (!attribute.Value.StartsWith("{Binding") && !attribute.Value.EndsWith(".xaml")) {
					try {
						var uri: Uri = new Uri(attribute.Value);
						if (uri.Scheme == "mforms" && uri.Host == "bookmark") {
							var collection: NameValueCollection = HttpUtility.ParseQueryString(new Uri(uri).Query);
							for (var name: String in collection) {
								if ("keys,fields,parameters".Contains(name, StringComparison.InvariantCultureIgnoreCase)) {
									var pairs: String[] = collection[name].Split(",");
									for (var j: int = 0; j < pairs.Length; j = j + 2) {
										var key: String = pairs[j];
										var value: String = HttpUtility.UrlDecode(pairs[j + 1], Encoding.UTF8).Trim();
										if (!String.IsNullOrEmpty(value)) {
											if (!regex.IsMatch(value)) {
												debug.WriteLine([mashupName, relativeUri, GetPath(attribute.OwnerElement) + "@" + attribute.Name, key, value]);
											}
										}
									}
								}
							}
						}
					} catch (ex: UriFormatException) {
						debug.WriteLine([ex, attribute.Value]); 
					}
				}
			}			
		}

		// ensure the MForms Automation don't have hard-coded values; based on https://m3ideas.org/2016/05/24/mashup-quality-control-6/
		function verifyMFormsAutomation(mashupName: String, relativeUri: String, document: XmlDocument) {
			var nodes: XmlNodeList = document.SelectNodes("//@*[name()='Uri' or name()='LinkUri']"); // PENDING: also check the MForms Automation that are declared in CDATA sections; see https://m3ideas.org/2016/07/13/mforms-automation-in-mashups/ . Maybe this XPath expression: //*[contains(name(), 'Uri')]
			for (var attribute: XmlAttribute in nodes) {
				if (!attribute.Value.StartsWith("{Binding") && !attribute.Value.EndsWith(".xaml")) {
					try {
						var uri: Uri = new Uri(attribute.Value);
						if (uri.Scheme == "mforms" && (uri.Host == "_automation" || uri.Host == "automation")) {
							var collection: NameValueCollection = HttpUtility.ParseQueryString(new Uri(uri).Query);
							var automation: MFormsAutomation = new MFormsAutomation();
							automation.FromXml(collection["data"]);
							for (var step: MFormsAutomation.Step in automation.Steps) {
								for (var field: MFormsAutomation.Field in step.Fields) {
									if (!String.IsNullOrEmpty(field.Value)) {
										if (!regex.IsMatch(field.Value)) {
											debug.WriteLine([mashupName, relativeUri, GetPath(attribute.OwnerElement) + "@" + attribute.Name, field.Name, field.Value]);
										}
									}
								}
							}
						}
					} catch (ex: UriFormatException) {
						debug.WriteLine([ex, attribute.Value]); 
					}
				}
			}
		}

		// verify Document Archive (Infor Document Management) (find hard-coded values)
		function verifyDocumentArchive(mashupName: String, relativeUri: String, document: XmlDocument) {
			// PENDING
			var nsmanager: XmlNamespaceManager = new XmlNamespaceManager(document.NameTable);
			nsmanager.AddNamespace("da", "clr-namespace:DocumentArchive.Mashup;assembly=DocumentArchive");
			//var nodes  = document.SelectNodes("//da:*", nsmanager);
			var nodes  = document.SelectNodes("//*[@TargetKey='SearchXQuery']", nsmanager);
			for (var node: XmlElement in nodes) {
				debug.WriteLine([mashupName, relativeUri, GetPath(node), node.Attributes["Value"].Value]);
			}
		}

		// verify M3 Web Services (ensure BaseUri uses the profile URL; ensure no hard-coded credentials; find hard-coded values; etc.)
		function verifyWebServices(mashupName: String, relativeUri: String, document: XmlDocument) {
			var nodes = document.SelectNodes("//*[(@TargetKey='WS.Wsdl' or @TargetKey='WS.Address') and not(starts-with(@Value, '{}{BaseUri}'))]");
			for (var node: XmlElement in nodes) {
				debug.WriteLine([mashupName, relativeUri, GetPath(node), "@TargetKey", node.Attributes["TargetKey"].Value, node.Attributes["Value"].Value]);
			}
			nodes = document.SelectNodes("//*[@SourceKey='BaseUri' and not(@Value='{mashup:ProfileValue Path=M3/WebService/url}')]");
			for (node in nodes) {
				debug.WriteLine([mashupName, relativeUri, GetPath(node), "@SourceKey", node.Attributes["SourceKey"].Value, node.Attributes["Value"].Value]);
			}
			nodes = document.SelectNodes("//*[(@Key='WS.User' or @Key='WS.Password') or (@Key='WS.CredentialSource' and not(@Value='Current'))]");
			for (node in nodes) {
				debug.WriteLine([mashupName, relativeUri, GetPath(node), "@Key", node.Attributes["Key"].Value, node.Attributes["Value"].Value]);
			}
		}

		// verify there are no other hard-coded values
		function verifyValues(mashupName: String, relativeUri: String, document: XmlDocument) {
			return; // PENDING: this is too verbose, there are thousands of hard-coded values
			var attributes = ["Value", "DefaultValue", "SelectedValue", "SourceValue", "TargetValue"]; // found in mashup:Parameter, mashup:DataParameter, mashup:Condition, etc.
			var nodes = document.SelectNodes("//*[@" + attributes.join(" or @") + "]");
			for (var node: XmlElement in nodes) {
				for (var i: int in attributes) {
					var attribute = attributes[i];
					if (node.HasAttribute[attribute]) {
						var value = node.Attributes[attribute].Value;
						// PENDING: also exclude {Binding ... Path=Visibility}" TargetValue="Collapsed"
						if (!value.StartsWith("{Binding") && !value.StartsWith("{mashup:UserContextValue") && !value.StartsWith("{mashup:ProfileValue") && !value.StartsWith("{}{BaseUri}/") && !value.StartsWith("mailto:{") && !(node.HasAttribute["TargetKey"] && (node.Attributes["TargetKey"].Value == "WS.Operation" || node.Attributes["TargetKey"].Value == "WS.Contract")) && !(node.HasAttribute["Key"] && node.Attributes["Key"].Value == "WS.CredentialSource" && value == "Current") && !(node.HasAttribute["SourceKey"] && (node.Attributes["SourceKey"].Value == "MI.Program" || node.Attributes["SourceKey"].Value == "MI.Transaction"))) {
							debug.WriteLine([mashupName, relativeUri, GetPath(node), attribute, value]); // when I use GetPath(node) I loose many results
						}
					}
				}
			}
		}

		// returns the absolute path, qualified by name, of the specified node, by recursive backwards traversal, best guess
		function GetPath(node: XmlNode) {
			var s: String = "";
			while (node != null && node.NodeType == XmlNodeType.Element && node.NodeType != XmlNodeType.Document) {
				var element: XmlElement = node;
				if (element.HasAttribute("Name")) {
					s = node.Name + "[@Name='" + element.GetAttribute("Name") + "']/" + s;
				} else {
					s = node.Name + "/" + s;
				}
				node = node.ParentNode;
			}
			return s;
		}
	}
}
